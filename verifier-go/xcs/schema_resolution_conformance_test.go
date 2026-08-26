package xcs

import (
	"encoding/json"
	"errors"
	"reflect"
	"testing"
)

type schemaResolutionCatalogVector struct {
	UID              string          `json:"uid"`
	Definition       json.RawMessage `json:"definition"`
	Publisher        string          `json:"publisher"`
	NetworkID        uint32          `json:"networkId"`
	LedgerIndex      uint32          `json:"ledgerIndex"`
	TransactionIndex uint32          `json:"transactionIndex"`
}

type schemaResolutionContextVector struct {
	NetworkID        uint32 `json:"networkId"`
	Publisher        string `json:"publisher"`
	LedgerIndex      uint32 `json:"ledgerIndex"`
	TransactionIndex uint32 `json:"transactionIndex"`
}

type schemaResolutionExpectedVector struct {
	Fields  map[string]FieldDescriptor `json:"fields"`
	Lineage []string                   `json:"lineage"`
}

type schemaResolutionVector struct {
	ID        string                          `json:"id"`
	Name      string                          `json:"name"`
	Valid     bool                            `json:"valid"`
	Input     json.RawMessage                 `json:"input"`
	Context   schemaResolutionContextVector   `json:"context"`
	Catalog   []schemaResolutionCatalogVector `json:"catalog"`
	Expected  *schemaResolutionExpectedVector `json:"expected,omitempty"`
	ErrorCode string                          `json:"errorCode,omitempty"`
}

func runSchemaResolutionVectors(t *testing.T, data []byte) {
	t.Helper()
	var vectors struct {
		Version string                   `json:"version"`
		Cases   []schemaResolutionVector `json:"cases"`
	}
	if err := decodeStrictJSON(data, &vectors); err != nil {
		t.Fatal(err)
	}

	for _, vector := range vectors.Cases {
		t.Run(vector.ID+" "+vector.Name, func(t *testing.T) {
			schema, err := ParseSchema(vector.Input)
			if err != nil {
				t.Fatalf("parse input schema: %v", err)
			}

			catalog := make(map[string]RegisteredSchema, len(vector.Catalog))
			for _, entry := range vector.Catalog {
				if _, duplicate := catalog[entry.UID]; duplicate {
					t.Fatalf("duplicate catalog UID %s", entry.UID)
				}
				definition, parseErr := ParseSchema(entry.Definition)
				if parseErr != nil {
					t.Fatalf("parse catalog schema %s: %v", entry.UID, parseErr)
				}
				catalog[entry.UID] = RegisteredSchema{
					UID:              entry.UID,
					Definition:       definition,
					Publisher:        entry.Publisher,
					NetworkID:        entry.NetworkID,
					LedgerIndex:      entry.LedgerIndex,
					TransactionIndex: entry.TransactionIndex,
				}
			}

			resolved, err := ResolveSchema(schema, SchemaResolutionContext{
				NetworkID:        vector.Context.NetworkID,
				Publisher:        vector.Context.Publisher,
				LedgerIndex:      vector.Context.LedgerIndex,
				TransactionIndex: vector.Context.TransactionIndex,
				GetSchema: func(uid string) (RegisteredSchema, bool) {
					registered, found := catalog[uid]
					return registered, found
				},
			})

			if !vector.Valid {
				if vector.ErrorCode == "" {
					t.Fatal("invalid resolution vector must declare errorCode")
				}
				var protocolError *Error
				if !errors.As(err, &protocolError) || protocolError.Code != vector.ErrorCode {
					t.Fatalf("expected %s, got %v", vector.ErrorCode, err)
				}
				return
			}

			if err != nil {
				t.Fatalf("expected valid resolution: %v", err)
			}
			if vector.Expected == nil {
				t.Fatal("valid resolution vector must declare expected output")
			}
			requireStructuralEqual(
				t,
				"normalized definition",
				schemaMap(schema),
				schemaMap(resolved.Definition),
			)
			requireStructuralEqual(
				t,
				"resolved fields",
				fieldsMap(vector.Expected.Fields),
				fieldsMap(resolved.Fields),
			)
			requireStructuralEqual(t, "lineage", vector.Expected.Lineage, resolved.Lineage)
		})
	}
}

func requireStructuralEqual(t *testing.T, label string, expected, actual any) {
	t.Helper()
	if reflect.DeepEqual(expected, actual) {
		return
	}
	expectedJSON, expectedErr := json.Marshal(expected)
	actualJSON, actualErr := json.Marshal(actual)
	if expectedErr != nil || actualErr != nil {
		t.Fatalf("%s mismatch\nwant %#v\ngot  %#v", label, expected, actual)
	}
	t.Fatalf("%s mismatch\nwant %s\ngot  %s", label, expectedJSON, actualJSON)
}
