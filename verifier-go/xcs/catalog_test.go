package xcs

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"testing"
)

const catalogTestPublisher = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh"

func catalogTestProfile() NetworkProfile {
	return NetworkProfile{
		ProfileID: "xrpl-testnet-xcs-v0.1-catalog-test", XCSVersion: "0.1", NetworkID: 1,
		RequiredAmendment: repeatedHexByte('A'),
		RegistryAddress:   catalogTestPublisher, RegistrationAmountDrops: "1",
		ActivationLedgerIndex: 9,
		ActivationLedgerHash:  "0909090909090909090909090909090909090909090909090909090909090909",
	}
}

func repeatedHexByte(value byte) string {
	return string(bytes.Repeat([]byte{value}, 64))
}

func catalogTestEntry(t *testing.T, definition SchemaDefinition, ledgerIndex uint32, transactionIndex uint32) SchemaCatalogEntryV1 {
	t.Helper()
	ledgerByte := byte("0123456789abcdef"[ledgerIndex%16])
	transactionByte := byte("0123456789abcdef"[transactionIndex%16])
	ledgerHash := repeatedHexByte(ledgerByte)
	uid, _, err := ComputeSchemaUID(SchemaUIDInput{
		NetworkID: 1, LedgerHash: ledgerHash, LedgerIndex: ledgerIndex,
		TransactionIndex: transactionIndex, Publisher: catalogTestPublisher, Schema: definition,
	})
	if err != nil {
		t.Fatal(err)
	}
	return SchemaCatalogEntryV1{
		UID: uid, Definition: definition, Publisher: catalogTestPublisher,
		LedgerIndex: ledgerIndex, LedgerHash: ledgerHash, TransactionIndex: transactionIndex,
		TransactionHash: repeatedHexByte(transactionByte),
	}
}

func catalogTestBundle(t *testing.T) SchemaCatalogBundleV1 {
	t.Helper()
	previous := catalogTestEntry(t, SchemaDefinition{
		XCSVersion: "0.1", Name: "Previous course", Description: "The previous independent course schema.",
		Fields: map[string]FieldDescriptor{"previousCourseId": {Type: "string"}},
	}, 10, 1)
	parent := catalogTestEntry(t, SchemaDefinition{
		XCSVersion: "0.1", Name: "Course", Description: "The reusable course schema.",
		Fields: map[string]FieldDescriptor{"courseId": {Type: "string"}},
	}, 10, 2)
	target := catalogTestEntry(t, SchemaDefinition{
		XCSVersion: "0.1", Name: "Course completion", Description: "Confirms successful course completion.",
		Extends: parent.UID, Supersedes: previous.UID,
		Fields: map[string]FieldDescriptor{"completed": {Type: "bool"}},
	}, 11, 0)
	return SchemaCatalogBundleV1{
		Format: SchemaCatalogFormatV1, Profile: catalogTestProfile(), TargetUID: target.UID,
		Checkpoint: SchemaCatalogCheckpointV1{LedgerIndex: 12, LedgerHash: repeatedHexByte('c')},
		Schemas:    []SchemaCatalogEntryV1{previous, parent, target},
	}
}

func requireCatalogError(t *testing.T, err error, path string) {
	t.Helper()
	var protocolError *Error
	if !errors.As(err, &protocolError) || protocolError.Code != "SCHEMA_CATALOG_INVALID" || protocolError.Path != path {
		t.Fatalf("expected SCHEMA_CATALOG_INVALID at %s, got %v", path, err)
	}
}

func requireCatalogLimitError(t *testing.T, err error) {
	t.Helper()
	var protocolError *Error
	if !errors.As(err, &protocolError) || protocolError.Code != "SCHEMA_CATALOG_LIMIT_EXCEEDED" || protocolError.Path != "$.schemas" {
		t.Fatalf("expected SCHEMA_CATALOG_LIMIT_EXCEEDED at $.schemas, got %v", err)
	}
}

func catalogLimitBundle(t *testing.T, entryCount int) SchemaCatalogBundleV1 {
	t.Helper()
	entries := make([]SchemaCatalogEntryV1, 0, entryCount)
	previousUID := ""
	for index := 0; index < entryCount; index++ {
		definition := SchemaDefinition{
			XCSVersion: "0.1", Name: "Catalog limit", Description: "Exercises the normative catalog entry boundary.",
			Fields: map[string]FieldDescriptor{"value": {Type: "string"}},
		}
		if previousUID != "" {
			definition.Supersedes = previousUID
		}
		entry := catalogTestEntry(t, definition, 10, uint32(index))
		entry.TransactionHash = fmt.Sprintf("%064x", index+1)
		entries = append(entries, entry)
		previousUID = entry.UID
	}
	return SchemaCatalogBundleV1{
		Format: SchemaCatalogFormatV1, Profile: catalogTestProfile(), TargetUID: previousUID,
		Checkpoint: SchemaCatalogCheckpointV1{LedgerIndex: 11, LedgerHash: repeatedHexByte('b')},
		Schemas:    entries,
	}
}

func closureCatalog(ancestorCount int) (SchemaDefinition, map[string]RegisteredSchema) {
	catalog := make(map[string]RegisteredSchema, ancestorCount)
	previousUID := ""
	for index := 0; index < ancestorCount; index++ {
		uid := fmt.Sprintf("%064x", index+1)
		definition := SchemaDefinition{
			XCSVersion: "0.1", Name: "Closure", Description: "Synthetic relation closure entry.",
			Fields: map[string]FieldDescriptor{"value": {Type: "string"}},
		}
		if previousUID != "" {
			definition.Supersedes = previousUID
		}
		catalog[uid] = RegisteredSchema{UID: uid, Definition: definition}
		previousUID = uid
	}
	return SchemaDefinition{Supersedes: previousUID}, catalog
}

func TestSchemaCatalogParsesAndResolvesTarget(t *testing.T) {
	bundle := catalogTestBundle(t)
	data, err := json.Marshal(bundle)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := ParseSchemaCatalogBundle(data)
	if err != nil {
		t.Fatal(err)
	}
	resolved, err := ResolveSchemaCatalogBundle(parsed)
	if err != nil {
		t.Fatal(err)
	}
	if resolved.Target.UID != bundle.TargetUID || len(resolved.ResolvedTarget.Lineage) != 1 || resolved.ResolvedTarget.Lineage[0] != bundle.Schemas[1].UID {
		t.Fatalf("unexpected resolved target: %#v", resolved)
	}
	if len(resolved.ResolvedTarget.Fields) != 2 {
		t.Fatalf("expected inherited and local fields, got %#v", resolved.ResolvedTarget.Fields)
	}
}

func TestSchemaCatalogResolutionContextReturnsDeepClonedDefinitions(t *testing.T) {
	items := FieldDescriptor{Type: "string"}
	parent := catalogTestEntry(t, SchemaDefinition{
		XCSVersion: "0.1", Name: "Nested parent", Description: "Exercises immutable catalog lookups.",
		Fields: map[string]FieldDescriptor{
			"tags": {Type: "array", Items: &items},
		},
	}, 10, 1)
	target := catalogTestEntry(t, SchemaDefinition{
		XCSVersion: "0.1", Name: "Nested target", Description: "Inherits the immutable parent.",
		Extends: parent.UID,
		Fields:  map[string]FieldDescriptor{"completed": {Type: "bool"}},
	}, 10, 2)
	bundle := SchemaCatalogBundleV1{
		Format: SchemaCatalogFormatV1, Profile: catalogTestProfile(), TargetUID: target.UID,
		Checkpoint: SchemaCatalogCheckpointV1{LedgerIndex: 11, LedgerHash: repeatedHexByte('b')},
		Schemas:    []SchemaCatalogEntryV1{parent, target},
	}

	resolved, err := ResolveSchemaCatalogBundle(bundle)
	if err != nil {
		t.Fatal(err)
	}
	first, found := resolved.ResolutionContext.GetSchema(parent.UID)
	if !found {
		t.Fatal("expected parent lookup")
	}
	firstTags := first.Definition.Fields["tags"]
	if firstTags.Items == nil {
		t.Fatal("expected nested array item descriptor")
	}
	firstTags.Items.Type = "bytes"
	first.Definition.Fields["injected"] = FieldDescriptor{Type: "address"}

	// Mutating another caller-visible representation must not alias the lookup either.
	bundleTags := resolved.Bundle.Schemas[0].Definition.Fields["tags"]
	if bundleTags.Items == nil {
		t.Fatal("expected nested bundle descriptor")
	}
	bundleTags.Items.Type = "uint"
	resolved.Bundle.Schemas[0].Definition.Fields["bundleInjected"] = FieldDescriptor{Type: "int"}

	second, found := resolved.ResolutionContext.GetSchema(parent.UID)
	if !found {
		t.Fatal("expected second parent lookup")
	}
	secondTags := second.Definition.Fields["tags"]
	if secondTags.Items == nil || secondTags.Items.Type != "string" {
		t.Fatalf("lookup mutation escaped into the catalog: %#v", secondTags)
	}
	if _, found := second.Definition.Fields["injected"]; found {
		t.Fatal("first lookup mutated the second lookup")
	}
	if _, found := second.Definition.Fields["bundleInjected"]; found {
		t.Fatal("returned bundle mutated the resolution lookup")
	}

	again, err := ResolveSchema(resolved.Target.Definition, resolved.ResolutionContext)
	if err != nil {
		t.Fatal(err)
	}
	resolvedTags := again.Fields["tags"]
	if resolvedTags.Items == nil || resolvedTags.Items.Type != "string" {
		t.Fatalf("lookup mutation changed subsequent resolution: %#v", resolvedTags)
	}
}

func TestSchemaCatalogEnforcesNormativeEntryLimit(t *testing.T) {
	maximum := catalogLimitBundle(t, MaxSchemaCatalogEntries)
	if _, err := ValidateSchemaCatalogBundle(maximum); err != nil {
		t.Fatalf("expected exactly %d catalog entries to be valid: %v", MaxSchemaCatalogEntries, err)
	}
	encoded, err := json.Marshal(maximum)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ParseSchemaCatalogBundle(encoded); err != nil {
		t.Fatalf("expected exactly %d encoded catalog entries to be valid: %v", MaxSchemaCatalogEntries, err)
	}

	overflow := catalogLimitBundle(t, MaxSchemaCatalogEntries+1)
	_, err = ValidateSchemaCatalogBundle(overflow)
	requireCatalogLimitError(t, err)
	encoded, err = json.Marshal(overflow)
	if err != nil {
		t.Fatal(err)
	}
	_, err = ParseSchemaCatalogBundle(encoded)
	requireCatalogLimitError(t, err)
}

func TestSchemaCatalogClosureLimitCountsCandidateAndDeduplicatesSharedAncestors(t *testing.T) {
	lookup := func(catalog map[string]RegisteredSchema) func(string) (RegisteredSchema, bool) {
		return func(uid string) (RegisteredSchema, bool) {
			entry, found := catalog[uid]
			return entry, found
		}
	}

	exactCandidate, exactCatalog := closureCatalog(MaxSchemaCatalogEntries - 1)
	if err := AssertSchemaCatalogClosureWithinLimit(exactCandidate, lookup(exactCatalog)); err != nil {
		t.Fatalf("expected exactly %d unique closure entries to be valid: %v", MaxSchemaCatalogEntries, err)
	}

	overflowCandidate, overflowCatalog := closureCatalog(MaxSchemaCatalogEntries)
	requireCatalogLimitError(
		t,
		AssertSchemaCatalogClosureWithinLimit(overflowCandidate, lookup(overflowCatalog)),
	)

	sharedCandidate, sharedCatalog := closureCatalog(MaxSchemaCatalogEntries - 3)
	sharedTip := sharedCandidate.Supersedes
	leftUID := fmt.Sprintf("%064x", MaxSchemaCatalogEntries-2)
	rightUID := fmt.Sprintf("%064x", MaxSchemaCatalogEntries-1)
	sharedCatalog[leftUID] = RegisteredSchema{
		UID: leftUID, Definition: SchemaDefinition{Supersedes: sharedTip},
	}
	sharedCatalog[rightUID] = RegisteredSchema{
		UID: rightUID, Definition: SchemaDefinition{Supersedes: sharedTip},
	}
	sharedCandidate = SchemaDefinition{Extends: leftUID, Supersedes: rightUID}
	if err := AssertSchemaCatalogClosureWithinLimit(sharedCandidate, lookup(sharedCatalog)); err != nil {
		t.Fatalf("expected shared ancestors to count once at the %d-entry boundary: %v", MaxSchemaCatalogEntries, err)
	}
}

func TestSchemaCatalogRejectsUnknownAndDuplicateJSONProperties(t *testing.T) {
	data, err := json.Marshal(catalogTestBundle(t))
	if err != nil {
		t.Fatal(err)
	}
	unknown := bytes.Replace(data, []byte(`{"format":`), []byte(`{"future":true,"format":`), 1)
	_, err = ParseSchemaCatalogBundle(unknown)
	requireCatalogError(t, err, "$.future")

	duplicate := bytes.Replace(data, []byte(`{"format":`), []byte(`{"format":"xcs-schema-catalog/1","format":`), 1)
	_, err = ParseSchemaCatalogBundle(duplicate)
	var protocolError *Error
	if !errors.As(err, &protocolError) || protocolError.Code != "JSON_DUPLICATE_KEY" {
		t.Fatalf("expected JSON_DUPLICATE_KEY, got %v", err)
	}
}

func TestSchemaCatalogRejectsTamperingOrderAndUnrelatedEntries(t *testing.T) {
	tampered := catalogTestBundle(t)
	tampered.Schemas[2].UID = repeatedHexByte('f')
	tampered.TargetUID = repeatedHexByte('f')
	_, err := ValidateSchemaCatalogBundle(tampered)
	requireCatalogError(t, err, "$.schemas[2].uid")

	reversed := catalogTestBundle(t)
	reversed.Schemas[0], reversed.Schemas[1] = reversed.Schemas[1], reversed.Schemas[0]
	_, err = ValidateSchemaCatalogBundle(reversed)
	requireCatalogError(t, err, "$.schemas[1]")

	unrelated := catalogTestBundle(t)
	standalone := catalogTestEntry(t, SchemaDefinition{
		XCSVersion: "0.1", Name: "Unrelated", Description: "This schema is outside the target relation graph.",
		Fields: map[string]FieldDescriptor{"value": {Type: "string"}},
	}, 10, 3)
	unrelated.Schemas = append(unrelated.Schemas[:2], append([]SchemaCatalogEntryV1{standalone}, unrelated.Schemas[2:]...)...)
	_, err = ValidateSchemaCatalogBundle(unrelated)
	requireCatalogError(t, err, "$.schemas")
}

func TestSchemaCatalogBindsActivationAndCheckpointHashes(t *testing.T) {
	activation := catalogTestBundle(t)
	activation.Schemas[0].LedgerIndex = activation.Profile.ActivationLedgerIndex
	activation.Schemas[0].LedgerHash = repeatedHexByte('f')
	_, err := ValidateSchemaCatalogBundle(activation)
	requireCatalogError(t, err, "$.schemas[0].ledgerHash")

	checkpoint := catalogTestBundle(t)
	checkpoint.Checkpoint.LedgerIndex = checkpoint.Schemas[2].LedgerIndex
	checkpoint.Checkpoint.LedgerHash = repeatedHexByte('f')
	_, err = ValidateSchemaCatalogBundle(checkpoint)
	requireCatalogError(t, err, "$.schemas[2].ledgerHash")

	forkedLedger := catalogTestBundle(t)
	forkedLedger.Schemas[1].LedgerHash = repeatedHexByte('f')
	uid, _, err := ComputeSchemaUID(SchemaUIDInput{
		NetworkID: forkedLedger.Profile.NetworkID, LedgerHash: forkedLedger.Schemas[1].LedgerHash,
		LedgerIndex:      forkedLedger.Schemas[1].LedgerIndex,
		TransactionIndex: forkedLedger.Schemas[1].TransactionIndex,
		Publisher:        forkedLedger.Schemas[1].Publisher, Schema: forkedLedger.Schemas[1].Definition,
	})
	if err != nil {
		t.Fatal(err)
	}
	forkedLedger.Schemas[1].UID = uid
	_, err = ValidateSchemaCatalogBundle(forkedLedger)
	requireCatalogError(t, err, "$.schemas[1].ledgerHash")
}

func TestNetworkProfileRequiresPresentNumericFields(t *testing.T) {
	profile := map[string]any{
		"profileId": "xrpl-testnet-xcs-v0.1-vector", "xcsVersion": "0.1", "networkId": 1,
		"requiredAmendment": repeatedHexByte('a'), "registryAddress": catalogTestPublisher,
		"registrationAmountDrops": "1", "activationLedgerIndex": 1,
		"activationLedgerHash": repeatedHexByte('b'),
	}
	for _, field := range []string{"networkId", "activationLedgerIndex"} {
		t.Run(field, func(t *testing.T) {
			copy := make(map[string]any, len(profile))
			for key, value := range profile {
				copy[key] = value
			}
			delete(copy, field)
			data, err := json.Marshal(copy)
			if err != nil {
				t.Fatal(err)
			}
			_, err = ParseNetworkProfile(data)
			var protocolError *Error
			if !errors.As(err, &protocolError) || protocolError.Code != "NETWORK_PROFILE_INVALID" {
				t.Fatalf("expected NETWORK_PROFILE_INVALID, got %v", err)
			}
		})
	}
}
