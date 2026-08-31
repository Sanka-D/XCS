package xcs

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
)

type schemaCatalogConformanceCase struct {
	ID                    string `json:"id"`
	Name                  string `json:"name"`
	Topology              string `json:"topology"`
	AncestorCount         int    `json:"ancestorCount,omitempty"`
	SharedAncestorCount   int    `json:"sharedAncestorCount,omitempty"`
	Valid                 bool   `json:"valid"`
	ErrorCode             string `json:"errorCode,omitempty"`
	ExpectedUniqueEntries int    `json:"expectedUniqueEntries"`
	NumericField          string `json:"numericField,omitempty"`
	Original              uint32 `json:"original,omitempty"`
	Token                 string `json:"token,omitempty"`
}

func conformanceCatalogDefinition(supersedes string) SchemaDefinition {
	return SchemaDefinition{
		XCSVersion: "0.1",
		Name:       "Conformance catalog entry",
		Description: "A deterministic generated entry for the schema catalog " +
			"closure limit vectors.",
		Supersedes: supersedes,
		Fields:     map[string]FieldDescriptor{"value": {Type: "string"}},
	}
}

func conformanceCatalogChain(count int) (map[string]RegisteredSchema, string) {
	catalog := make(map[string]RegisteredSchema, count)
	previousUID := ""
	for index := 0; index < count; index++ {
		uid := fmt.Sprintf("%064x", index+1)
		definition := conformanceCatalogDefinition(previousUID)
		catalog[uid] = RegisteredSchema{UID: uid, Definition: definition}
		previousUID = uid
	}
	return catalog, previousUID
}

func conformanceCatalogVector(
	vector schemaCatalogConformanceCase,
) (SchemaDefinition, map[string]RegisteredSchema, error) {
	switch vector.Topology {
	case "linear-supersedes":
		if vector.AncestorCount < 1 || vector.SharedAncestorCount != 0 {
			return SchemaDefinition{}, nil, fmt.Errorf("invalid linear topology counts")
		}
		catalog, tip := conformanceCatalogChain(vector.AncestorCount)
		return conformanceCatalogDefinition(tip), catalog, nil
	case "shared-supersedes":
		if vector.SharedAncestorCount < 1 || vector.AncestorCount != 0 {
			return SchemaDefinition{}, nil, fmt.Errorf("invalid shared topology counts")
		}
		catalog, tip := conformanceCatalogChain(vector.SharedAncestorCount)
		leftUID := fmt.Sprintf("%064x", vector.SharedAncestorCount+1)
		rightUID := fmt.Sprintf("%064x", vector.SharedAncestorCount+2)
		catalog[leftUID] = RegisteredSchema{
			UID: leftUID, Definition: conformanceCatalogDefinition(tip),
		}
		catalog[rightUID] = RegisteredSchema{
			UID: rightUID, Definition: conformanceCatalogDefinition(tip),
		}
		candidate := conformanceCatalogDefinition(rightUID)
		candidate.Extends = leftUID
		return candidate, catalog, nil
	default:
		return SchemaDefinition{}, nil, fmt.Errorf("unknown topology %q", vector.Topology)
	}
}

func conformanceNumericCatalogJSON(t *testing.T, vector schemaCatalogConformanceCase) []byte {
	t.Helper()
	transactionIndex := uint32(0)
	if vector.NumericField == "schema.transactionIndex" {
		transactionIndex = vector.Original
	}
	entry := catalogTestEntry(t, SchemaDefinition{
		XCSVersion:  "0.1",
		Name:        "JSON number catalog",
		Description: "Exercises semantically integral uint32 JSON numbers.",
		Fields:      map[string]FieldDescriptor{"courseId": {Type: "string"}},
	}, 10, transactionIndex)
	bundle := SchemaCatalogBundleV1{
		Format:     SchemaCatalogFormatV1,
		Profile:    catalogTestProfile(),
		TargetUID:  entry.UID,
		Checkpoint: SchemaCatalogCheckpointV1{LedgerIndex: 10, LedgerHash: entry.LedgerHash},
		Schemas:    []SchemaCatalogEntryV1{entry},
	}
	data, err := json.Marshal(bundle)
	if err != nil {
		t.Fatal(err)
	}

	var from string
	switch vector.NumericField {
	case "checkpoint.ledgerIndex":
		from = fmt.Sprintf(`"checkpoint":{"ledgerIndex":%d`, vector.Original)
	case "schema.ledgerIndex":
		from = fmt.Sprintf(`"publisher":"%s","ledgerIndex":%d`, catalogTestPublisher, vector.Original)
	case "schema.transactionIndex":
		from = fmt.Sprintf(`"transactionIndex":%d,"transactionHash"`, vector.Original)
	default:
		t.Fatalf("unknown numeric catalog field %q", vector.NumericField)
	}
	if bytes.Count(data, []byte(from)) != 1 {
		t.Fatalf("numeric catalog fixture does not contain exactly one %q", from)
	}
	return bytes.Replace(data, []byte(from), []byte(strings.Replace(from, fmt.Sprint(vector.Original), vector.Token, 1)), 1)
}

func runSchemaCatalogVectors(t *testing.T, data []byte) {
	t.Helper()
	var vectors struct {
		Version string                         `json:"version"`
		Limit   int                            `json:"limit"`
		Cases   []schemaCatalogConformanceCase `json:"cases"`
	}
	if err := decodeStrictJSON(data, &vectors); err != nil {
		t.Fatal(err)
	}
	if vectors.Version != "0.1" {
		t.Fatalf("unexpected schema catalog vector version %q", vectors.Version)
	}
	if vectors.Limit != MaxSchemaCatalogEntries {
		t.Fatalf("catalog limit mismatch: vectors=%d verifier=%d", vectors.Limit, MaxSchemaCatalogEntries)
	}

	for _, vector := range vectors.Cases {
		t.Run(vector.ID+" "+vector.Name, func(t *testing.T) {
			if vector.NumericField != "" {
				bundle, err := ParseSchemaCatalogBundle(conformanceNumericCatalogJSON(t, vector))
				if !vector.Valid {
					var protocolError *Error
					if !errors.As(err, &protocolError) || protocolError.Code != vector.ErrorCode {
						t.Fatalf("expected %s, got %v", vector.ErrorCode, err)
					}
					return
				}
				if err != nil {
					t.Fatalf("expected valid numeric catalog: %v", err)
				}
				expectedTransactionIndex := uint32(0)
				if vector.NumericField == "schema.transactionIndex" {
					expectedTransactionIndex = vector.Original
				}
				if bundle.Checkpoint.LedgerIndex != 10 || bundle.Schemas[0].LedgerIndex != 10 ||
					bundle.Schemas[0].TransactionIndex != expectedTransactionIndex {
					t.Fatalf("unexpected numeric catalog coordinates: %#v", bundle)
				}
				return
			}

			candidate, catalog, err := conformanceCatalogVector(vector)
			if err != nil {
				t.Fatal(err)
			}
			if actual := len(catalog) + 1; actual != vector.ExpectedUniqueEntries {
				t.Fatalf("generated closure has %d unique entries, want %d", actual, vector.ExpectedUniqueEntries)
			}

			err = AssertSchemaCatalogClosureWithinLimit(
				candidate,
				func(uid string) (RegisteredSchema, bool) {
					entry, found := catalog[uid]
					return entry, found
				},
			)
			if vector.Valid {
				if err != nil {
					t.Fatalf("expected valid catalog closure: %v", err)
				}
				return
			}
			var protocolError *Error
			if !errors.As(err, &protocolError) || protocolError.Code != vector.ErrorCode {
				t.Fatalf("expected %s, got %v", vector.ErrorCode, err)
			}
		})
	}
}
