package xcs

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const maxFuzzInputBytes = 64 * 1024

func readFuzzConformanceFile(f *testing.F, name string, destination any) {
	f.Helper()
	data, err := os.ReadFile(filepath.Join(conformanceDirectory(), name))
	if err != nil {
		f.Fatalf("read conformance seed file %s: %v", name, err)
	}
	if err := json.Unmarshal(data, destination); err != nil {
		f.Fatalf("decode conformance seed file %s: %v", name, err)
	}
}

func FuzzStrictJSONCanonicalRoundTrip(f *testing.F) {
	var vectors struct {
		Cases []struct {
			InputJSON string `json:"inputJson"`
		} `json:"cases"`
	}
	readFuzzConformanceFile(f, "canonicalization.json", &vectors)
	for _, vector := range vectors.Cases {
		f.Add([]byte(vector.InputJSON))
	}

	f.Fuzz(func(t *testing.T, data []byte) {
		if len(data) > maxFuzzInputBytes {
			return
		}
		parsed, err := ParseJSON(data)
		if err != nil {
			return
		}
		canonical, err := Canonicalize(parsed)
		if err != nil {
			// Strict JSON may still contain a number outside the I-JSON range.
			var protocolError *Error
			if errors.As(err, &protocolError) && protocolError.Code == "JSON_NON_IJSON_NUMBER" {
				return
			}
			t.Fatalf("strict JSON value cannot be canonicalized: %v\ninput: %q", err, data)
		}
		roundTripped, err := ParseJSON(canonical)
		if err != nil {
			t.Fatalf("canonical output cannot be parsed as strict JSON: %v\noutput: %q", err, canonical)
		}
		recanonical, err := Canonicalize(roundTripped)
		if err != nil {
			t.Fatalf("canonical output cannot be canonicalized again: %v\noutput: %q", err, canonical)
		}
		if !bytes.Equal(recanonical, canonical) {
			t.Fatalf("canonicalization is not idempotent\nfirst:  %q\nsecond: %q", canonical, recanonical)
		}
	})
}

func derivedSchemaUIDInput(data []byte) SchemaUIDInput {
	digest := sha256.Sum256(data)
	relationDigest := digest
	relationDigest[0] ^= 0xff
	ledgerHash := hex.EncodeToString(digest[:])
	if digest[0]&1 != 0 {
		ledgerHash = strings.ToUpper(ledgerHash)
	}

	scalarTypes := [...]string{"string", "bool", "uint", "int", "bytes", "address"}
	scalar := FieldDescriptor{
		Type:     scalarTypes[int(digest[1])%len(scalarTypes)],
		Optional: digest[2]&1 != 0,
	}
	var descriptor FieldDescriptor
	switch digest[3] % 3 {
	case 0:
		descriptor = scalar
	case 1:
		descriptor = FieldDescriptor{Type: "array", Optional: digest[2]&1 != 0, Items: &scalar}
	default:
		descriptor = FieldDescriptor{
			Type:     "object",
			Optional: digest[2]&1 != 0,
			Fields:   map[string]FieldDescriptor{"nested": scalar},
		}
	}

	schema := SchemaDefinition{
		XCSVersion:  "0.1",
		Name:        fmt.Sprintf("Fuzz schema %x", digest[:8]),
		Description: fmt.Sprintf("Deterministic schema generated from fuzz input %x", digest[8:24]),
		Fields: map[string]FieldDescriptor{
			fmt.Sprintf("field_%x", digest[24:28]): descriptor,
		},
	}
	if digest[4]&1 != 0 {
		schema.Extends = hex.EncodeToString(digest[:])
	}
	if digest[5]&1 != 0 {
		schema.Supersedes = hex.EncodeToString(relationDigest[:])
	}

	return SchemaUIDInput{
		NetworkID:        binary.BigEndian.Uint32(digest[0:4]),
		LedgerHash:       ledgerHash,
		LedgerIndex:      binary.BigEndian.Uint32(digest[4:8]),
		TransactionIndex: binary.BigEndian.Uint32(digest[8:12]),
		Publisher:        "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
		Schema:           schema,
	}
}

func FuzzSchemaUIDDeterminism(f *testing.F) {
	var vectors struct {
		Cases []struct {
			Input json.RawMessage `json:"input"`
		} `json:"cases"`
	}
	readFuzzConformanceFile(f, "schema-uid.json", &vectors)
	for _, vector := range vectors.Cases {
		f.Add([]byte(vector.Input))
	}

	f.Fuzz(func(t *testing.T, data []byte) {
		if len(data) > maxFuzzInputBytes {
			return
		}
		input, err := ParseSchemaUIDInput(data)
		if err != nil {
			input = derivedSchemaUIDInput(data)
		}
		uid, preimage, err := ComputeSchemaUID(input)
		if err != nil {
			input = derivedSchemaUIDInput(data)
			uid, preimage, err = ComputeSchemaUID(input)
		}
		if err != nil {
			t.Fatalf("derived valid schema UID input was rejected: %v", err)
		}

		repeatedUID, repeatedPreimage, err := ComputeSchemaUID(input)
		if err != nil {
			t.Fatalf("repeated schema UID computation failed: %v", err)
		}
		if uid != repeatedUID || !bytes.Equal(preimage, repeatedPreimage) {
			t.Fatalf(
				"schema UID computation is not deterministic\nfirst:  %s %q\nsecond: %s %q",
				uid,
				preimage,
				repeatedUID,
				repeatedPreimage,
			)
		}

		digest := sha256.Sum256(preimage)
		if expectedUID := hex.EncodeToString(digest[:]); uid != expectedUID {
			t.Fatalf("schema UID does not match SHA-256 of its preimage: want %s, got %s", expectedUID, uid)
		}
		parsedPreimage, err := ParseJSON(preimage)
		if err != nil {
			t.Fatalf("schema UID preimage is not strict JSON: %v\npreimage: %q", err, preimage)
		}
		canonicalPreimage, err := Canonicalize(parsedPreimage)
		if err != nil {
			t.Fatalf("schema UID preimage cannot be canonicalized: %v\npreimage: %q", err, preimage)
		}
		if !bytes.Equal(canonicalPreimage, preimage) {
			t.Fatalf("schema UID preimage is not canonical JCS\nwant: %q\ngot:  %q", canonicalPreimage, preimage)
		}

		caseVariant := input
		caseVariant.LedgerHash = strings.ToUpper(input.LedgerHash)
		caseUID, casePreimage, err := ComputeSchemaUID(caseVariant)
		if err != nil {
			t.Fatalf("uppercase ledger hash variant was rejected: %v", err)
		}
		if caseUID != uid || !bytes.Equal(casePreimage, preimage) {
			t.Fatalf("ledger hash casing changed the schema UID or preimage")
		}
	})
}
