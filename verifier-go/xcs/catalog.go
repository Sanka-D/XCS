package xcs

import (
	"encoding/json"
	"fmt"
	"regexp"
)

const (
	SchemaCatalogFormatV1   = "xcs-schema-catalog/1"
	MaxSchemaCatalogEntries = 256
)

var lowercaseHashPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)

type SchemaCatalogCheckpointV1 struct {
	LedgerIndex uint32 `json:"ledgerIndex"`
	LedgerHash  string `json:"ledgerHash"`
}

type SchemaCatalogEntryV1 struct {
	UID              string           `json:"uid"`
	Definition       SchemaDefinition `json:"definition"`
	Publisher        string           `json:"publisher"`
	LedgerIndex      uint32           `json:"ledgerIndex"`
	LedgerHash       string           `json:"ledgerHash"`
	TransactionIndex uint32           `json:"transactionIndex"`
	TransactionHash  string           `json:"transactionHash"`
}

type SchemaCatalogBundleV1 struct {
	Format     string                    `json:"format"`
	Profile    NetworkProfile            `json:"profile"`
	TargetUID  string                    `json:"targetUid"`
	Checkpoint SchemaCatalogCheckpointV1 `json:"checkpoint"`
	Schemas    []SchemaCatalogEntryV1    `json:"schemas"`
}

type ResolvedSchemaCatalogBundleV1 struct {
	Bundle            SchemaCatalogBundleV1   `json:"bundle"`
	Target            SchemaCatalogEntryV1    `json:"target"`
	ResolvedTarget    ResolvedSchema          `json:"resolvedTarget"`
	ResolutionContext SchemaResolutionContext `json:"-"`
}

func catalogInvalid(path string, format string, args ...any) error {
	return invalid("SCHEMA_CATALOG_INVALID", path, format, args...)
}

func exactObject(value any, expected []string, path string) (map[string]any, error) {
	object, ok := value.(map[string]any)
	if !ok {
		return nil, catalogInvalid(path, "expected an object")
	}
	wanted := make(map[string]bool, len(expected))
	for _, key := range expected {
		wanted[key] = true
	}
	for key := range object {
		if !wanted[key] {
			return nil, catalogInvalid(path+"."+key, "unknown property")
		}
	}
	if len(object) != len(wanted) {
		return nil, catalogInvalid(path, "object contains missing properties")
	}
	return object, nil
}

func catalogRelations(entry SchemaCatalogEntryV1) []string {
	return schemaDefinitionRelations(entry.Definition)
}

func schemaDefinitionRelations(definition SchemaDefinition) []string {
	relations := make([]string, 0, 2)
	if definition.Extends != "" {
		relations = append(relations, definition.Extends)
	}
	if definition.Supersedes != "" {
		relations = append(relations, definition.Supersedes)
	}
	return relations
}

func catalogEntryPrior(left SchemaCatalogEntryV1, right SchemaCatalogEntryV1) bool {
	return left.LedgerIndex < right.LedgerIndex ||
		(left.LedgerIndex == right.LedgerIndex && left.TransactionIndex < right.TransactionIndex)
}

func cloneCatalogEntry(entry SchemaCatalogEntryV1) SchemaCatalogEntryV1 {
	entry.Definition = cloneSchemaDefinition(entry.Definition)
	return entry
}

func cloneCatalogRegistration(registration RegisteredSchema) RegisteredSchema {
	registration.Definition = cloneSchemaDefinition(registration.Definition)
	return registration
}

// AssertSchemaCatalogClosureWithinLimit enforces the bound while constructing
// a portable catalog closure. The candidate counts as one entry, and a
// shared ancestor reached through multiple relations counts only once.
func AssertSchemaCatalogClosureWithinLimit(
	candidate SchemaDefinition,
	getSchema func(uid string) (RegisteredSchema, bool),
) error {
	if getSchema == nil {
		return catalogInvalid("$.schemas", "schema relation closure requires GetSchema")
	}

	seen := make(map[string]bool)
	pending := schemaDefinitionRelations(candidate)
	for len(pending) > 0 {
		uid := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		if seen[uid] {
			continue
		}
		seen[uid] = true
		if len(seen)+1 > MaxSchemaCatalogEntries {
			return invalid(
				"SCHEMA_CATALOG_LIMIT_EXCEEDED",
				"$.schemas",
				"schema relation closure exceeds %d entries",
				MaxSchemaCatalogEntries,
			)
		}
		entry, found := getSchema(uid)
		if !found {
			return catalogInvalid("$.schemas", "schema relation closure is incomplete at %s", uid)
		}
		pending = append(pending, schemaDefinitionRelations(entry.Definition)...)
	}
	return nil
}

func ValidateSchemaCatalogBundle(bundle SchemaCatalogBundleV1) (SchemaCatalogBundleV1, error) {
	if bundle.Format != SchemaCatalogFormatV1 {
		return SchemaCatalogBundleV1{}, catalogInvalid("$.format", "unsupported schema catalog format")
	}
	profile, err := ValidateNetworkProfile(bundle.Profile)
	if err != nil {
		return SchemaCatalogBundleV1{}, err
	}
	if !lowercaseHashPattern.MatchString(bundle.TargetUID) {
		return SchemaCatalogBundleV1{}, catalogInvalid("$.targetUid", "expected a lowercase 32-byte hexadecimal hash")
	}
	if bundle.Checkpoint.LedgerIndex < profile.ActivationLedgerIndex {
		return SchemaCatalogBundleV1{}, catalogInvalid("$.checkpoint.ledgerIndex", "must be at or after profile activation")
	}
	if !lowercaseHashPattern.MatchString(bundle.Checkpoint.LedgerHash) {
		return SchemaCatalogBundleV1{}, catalogInvalid("$.checkpoint.ledgerHash", "expected a lowercase 32-byte hexadecimal hash")
	}
	if bundle.Checkpoint.LedgerIndex == profile.ActivationLedgerIndex && bundle.Checkpoint.LedgerHash != profile.ActivationLedgerHash {
		return SchemaCatalogBundleV1{}, catalogInvalid("$.checkpoint.ledgerHash", "activation checkpoint hash does not match the network profile")
	}
	if len(bundle.Schemas) == 0 {
		return SchemaCatalogBundleV1{}, catalogInvalid("$.schemas", "must be a non-empty topologically ordered array")
	}
	if len(bundle.Schemas) > MaxSchemaCatalogEntries {
		return SchemaCatalogBundleV1{}, invalid(
			"SCHEMA_CATALOG_LIMIT_EXCEEDED",
			"$.schemas",
			"must contain at most %d entries",
			MaxSchemaCatalogEntries,
		)
	}

	normalized := SchemaCatalogBundleV1{
		Format: bundle.Format, Profile: profile, TargetUID: bundle.TargetUID,
		Checkpoint: bundle.Checkpoint, Schemas: make([]SchemaCatalogEntryV1, 0, len(bundle.Schemas)),
	}
	byUID := make(map[string]SchemaCatalogEntryV1, len(bundle.Schemas))
	transactionHashes := make(map[string]bool, len(bundle.Schemas))
	for index, original := range bundle.Schemas {
		entry := cloneCatalogEntry(original)
		path := fmt.Sprintf("$.schemas[%d]", index)
		if !lowercaseHashPattern.MatchString(entry.UID) {
			return SchemaCatalogBundleV1{}, catalogInvalid(path+".uid", "expected a lowercase 32-byte hexadecimal hash")
		}
		if !lowercaseHashPattern.MatchString(entry.LedgerHash) {
			return SchemaCatalogBundleV1{}, catalogInvalid(path+".ledgerHash", "expected a lowercase 32-byte hexadecimal hash")
		}
		if !lowercaseHashPattern.MatchString(entry.TransactionHash) {
			return SchemaCatalogBundleV1{}, catalogInvalid(path+".transactionHash", "expected a lowercase 32-byte hexadecimal hash")
		}
		if !IsClassicAddress(entry.Publisher) {
			return SchemaCatalogBundleV1{}, catalogInvalid(path+".publisher", "must be a checksummed XRPL classic address")
		}
		if entry.LedgerIndex < profile.ActivationLedgerIndex || entry.LedgerIndex > bundle.Checkpoint.LedgerIndex {
			return SchemaCatalogBundleV1{}, catalogInvalid(path+".ledgerIndex", "must fall between profile activation and the authoritative checkpoint")
		}
		if entry.LedgerIndex == profile.ActivationLedgerIndex && entry.LedgerHash != profile.ActivationLedgerHash {
			return SchemaCatalogBundleV1{}, catalogInvalid(path+".ledgerHash", "does not match the profile activation anchor")
		}
		if entry.LedgerIndex == bundle.Checkpoint.LedgerIndex && entry.LedgerHash != bundle.Checkpoint.LedgerHash {
			return SchemaCatalogBundleV1{}, catalogInvalid(path+".ledgerHash", "does not match the authoritative checkpoint")
		}
		if err := ValidateSchema(entry.Definition); err != nil {
			return SchemaCatalogBundleV1{}, err
		}
		computed, _, err := ComputeSchemaUID(SchemaUIDInput{
			NetworkID: profile.NetworkID, LedgerHash: entry.LedgerHash,
			LedgerIndex: entry.LedgerIndex, TransactionIndex: entry.TransactionIndex,
			Publisher: entry.Publisher, Schema: entry.Definition,
		})
		if err != nil {
			return SchemaCatalogBundleV1{}, err
		}
		if computed != entry.UID {
			return SchemaCatalogBundleV1{}, catalogInvalid(path+".uid", "does not match the normalized definition and ledger coordinates")
		}
		if _, duplicate := byUID[entry.UID]; duplicate {
			return SchemaCatalogBundleV1{}, catalogInvalid(path+".uid", "duplicate schema UID")
		}
		if transactionHashes[entry.TransactionHash] {
			return SchemaCatalogBundleV1{}, catalogInvalid(path+".transactionHash", "duplicate schema registration transaction hash")
		}
		if len(normalized.Schemas) > 0 && !catalogEntryPrior(normalized.Schemas[len(normalized.Schemas)-1], entry) {
			return SchemaCatalogBundleV1{}, catalogInvalid(path, "schemas must be strictly ordered by ledger and transaction index")
		}
		if len(normalized.Schemas) > 0 {
			previous := normalized.Schemas[len(normalized.Schemas)-1]
			if previous.LedgerIndex == entry.LedgerIndex && previous.LedgerHash != entry.LedgerHash {
				return SchemaCatalogBundleV1{}, catalogInvalid(path+".ledgerHash", "schemas at the same ledger index must share one ledger hash")
			}
		}
		for _, relation := range catalogRelations(entry) {
			if _, found := byUID[relation]; !found {
				return SchemaCatalogBundleV1{}, catalogInvalid(path, "relation %s must reference an earlier catalog entry", relation)
			}
		}
		normalized.Schemas = append(normalized.Schemas, entry)
		byUID[entry.UID] = entry
		transactionHashes[entry.TransactionHash] = true
	}
	if normalized.Schemas[len(normalized.Schemas)-1].UID != normalized.TargetUID {
		return SchemaCatalogBundleV1{}, catalogInvalid("$.targetUid", "must identify the final catalog entry")
	}

	reachable := make(map[string]bool, len(normalized.Schemas))
	pending := []string{normalized.TargetUID}
	for len(pending) > 0 {
		uid := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		if reachable[uid] {
			continue
		}
		reachable[uid] = true
		entry := byUID[uid]
		pending = append(pending, catalogRelations(entry)...)
	}
	if len(reachable) != len(normalized.Schemas) {
		return SchemaCatalogBundleV1{}, catalogInvalid("$.schemas", "contains a schema unrelated to targetUid")
	}
	return normalized, nil
}

func ParseSchemaCatalogBundle(data []byte) (SchemaCatalogBundleV1, error) {
	parsed, err := ParseJSON(data)
	if err != nil {
		return SchemaCatalogBundleV1{}, err
	}
	object, err := exactObject(parsed, []string{"format", "profile", "targetUid", "checkpoint", "schemas"}, "$")
	if err != nil {
		return SchemaCatalogBundleV1{}, err
	}
	checkpointObject, err := exactObject(object["checkpoint"], []string{"ledgerIndex", "ledgerHash"}, "$.checkpoint")
	if err != nil {
		return SchemaCatalogBundleV1{}, err
	}
	checkpointLedgerIndex, err := requireJSONUint32(checkpointObject, "ledgerIndex", "$.checkpoint", "SCHEMA_CATALOG_INVALID")
	if err != nil {
		return SchemaCatalogBundleV1{}, err
	}
	schemas, ok := object["schemas"].([]any)
	if !ok || len(schemas) == 0 {
		return SchemaCatalogBundleV1{}, catalogInvalid("$.schemas", "must be a non-empty array")
	}
	if len(schemas) > MaxSchemaCatalogEntries {
		return SchemaCatalogBundleV1{}, invalid(
			"SCHEMA_CATALOG_LIMIT_EXCEEDED",
			"$.schemas",
			"must contain at most %d entries",
			MaxSchemaCatalogEntries,
		)
	}
	ledgerIndices := make([]uint32, len(schemas))
	transactionIndices := make([]uint32, len(schemas))
	for index, value := range schemas {
		path := fmt.Sprintf("$.schemas[%d]", index)
		entryObject, err := exactObject(value, []string{
			"uid", "definition", "publisher", "ledgerIndex", "ledgerHash", "transactionIndex", "transactionHash",
		}, path)
		if err != nil {
			return SchemaCatalogBundleV1{}, err
		}
		ledgerIndices[index], err = requireJSONUint32(entryObject, "ledgerIndex", path, "SCHEMA_CATALOG_INVALID")
		if err != nil {
			return SchemaCatalogBundleV1{}, err
		}
		transactionIndices[index], err = requireJSONUint32(entryObject, "transactionIndex", path, "SCHEMA_CATALOG_INVALID")
		if err != nil {
			return SchemaCatalogBundleV1{}, err
		}
	}

	var raw struct {
		Format     string          `json:"format"`
		Profile    json.RawMessage `json:"profile"`
		TargetUID  string          `json:"targetUid"`
		Checkpoint struct {
			LedgerIndex json.RawMessage `json:"ledgerIndex"`
			LedgerHash  string          `json:"ledgerHash"`
		} `json:"checkpoint"`
		Schemas []struct {
			UID              string          `json:"uid"`
			Definition       json.RawMessage `json:"definition"`
			Publisher        string          `json:"publisher"`
			LedgerIndex      json.RawMessage `json:"ledgerIndex"`
			LedgerHash       string          `json:"ledgerHash"`
			TransactionIndex json.RawMessage `json:"transactionIndex"`
			TransactionHash  string          `json:"transactionHash"`
		} `json:"schemas"`
	}
	if err := decodeKnownJSON(data, &raw); err != nil {
		return SchemaCatalogBundleV1{}, catalogInvalid("$", "invalid catalog structure: %v", err)
	}
	profile, err := ParseNetworkProfile(raw.Profile)
	if err != nil {
		return SchemaCatalogBundleV1{}, err
	}
	bundle := SchemaCatalogBundleV1{
		Format: raw.Format, Profile: profile, TargetUID: raw.TargetUID,
		Checkpoint: SchemaCatalogCheckpointV1{
			LedgerIndex: checkpointLedgerIndex,
			LedgerHash:  raw.Checkpoint.LedgerHash,
		},
		Schemas: make([]SchemaCatalogEntryV1, 0, len(raw.Schemas)),
	}
	for index, rawEntry := range raw.Schemas {
		definition, err := ParseSchema(rawEntry.Definition)
		if err != nil {
			return SchemaCatalogBundleV1{}, err
		}
		bundle.Schemas = append(bundle.Schemas, SchemaCatalogEntryV1{
			UID: rawEntry.UID, Definition: definition, Publisher: rawEntry.Publisher,
			LedgerIndex: ledgerIndices[index], LedgerHash: rawEntry.LedgerHash,
			TransactionIndex: transactionIndices[index], TransactionHash: rawEntry.TransactionHash,
		})
	}
	return ValidateSchemaCatalogBundle(bundle)
}

func ResolveSchemaCatalogBundle(input SchemaCatalogBundleV1) (ResolvedSchemaCatalogBundleV1, error) {
	bundle, err := ValidateSchemaCatalogBundle(input)
	if err != nil {
		return ResolvedSchemaCatalogBundleV1{}, err
	}
	registered := make(map[string]RegisteredSchema, len(bundle.Schemas))
	var resolvedTarget ResolvedSchema
	var targetContext SchemaResolutionContext
	for _, entry := range bundle.Schemas {
		context := SchemaResolutionContext{
			NetworkID: bundle.Profile.NetworkID, Publisher: entry.Publisher,
			LedgerIndex: entry.LedgerIndex, TransactionIndex: entry.TransactionIndex,
			GetSchema: func(uid string) (RegisteredSchema, bool) {
				registration, found := registered[uid]
				if !found {
					return RegisteredSchema{}, false
				}
				return cloneCatalogRegistration(registration), true
			},
		}
		resolved, err := ResolveSchema(entry.Definition, context)
		if err != nil {
			return ResolvedSchemaCatalogBundleV1{}, err
		}
		registered[entry.UID] = cloneCatalogRegistration(RegisteredSchema{
			UID: entry.UID, Definition: entry.Definition,
			Publisher: entry.Publisher, NetworkID: bundle.Profile.NetworkID,
			LedgerIndex: entry.LedgerIndex, TransactionIndex: entry.TransactionIndex,
		})
		if entry.UID == bundle.TargetUID {
			resolvedTarget = resolved
			targetContext = context
		}
	}
	// Keep the final validated lookup immutable from the caller's perspective.
	lookup := make(map[string]RegisteredSchema, len(registered))
	for uid, registration := range registered {
		lookup[uid] = cloneCatalogRegistration(registration)
	}
	targetContext.GetSchema = func(uid string) (RegisteredSchema, bool) {
		registration, found := lookup[uid]
		if !found {
			return RegisteredSchema{}, false
		}
		return cloneCatalogRegistration(registration), true
	}
	return ResolvedSchemaCatalogBundleV1{
		Bundle: bundle, Target: bundle.Schemas[len(bundle.Schemas)-1],
		ResolvedTarget: resolvedTarget, ResolutionContext: targetContext,
	}, nil
}
