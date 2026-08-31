package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/XRPL-Commons/xcs/verifier-go/xcs"
)

const claimsTestSchema = `{"xcsVersion":"0.1","name":"Race participation","description":"Confirms participation in a race.","fields":{"bib":{"type":"uint"}}}`

func TestVerifyClaimsRejectsValidJSONThatIsNotAnObject(t *testing.T) {
	for _, claims := range []string{"[]", "null"} {
		t.Run(claims, func(t *testing.T) {
			err := verifyClaims([]byte(claimsTestSchema), []byte(claims))
			var protocolError *xcs.Error
			if !errors.As(err, &protocolError) || protocolError.Code != "CLAIMS_INVALID" {
				t.Fatalf("expected CLAIMS_INVALID, got %v", err)
			}
		})
	}
}

func writeTestFile(t *testing.T, directory string, name string, data []byte) string {
	t.Helper()
	path := filepath.Join(directory, name)
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func buildVerifierProcess(t *testing.T) string {
	t.Helper()
	binary := filepath.Join(t.TempDir(), "xcs-verify")
	command := exec.Command("go", "build", "-o", binary, ".")
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("build verifier process: %v\n%s", err, output)
	}
	return binary
}

func processFixture(t *testing.T) (schemaPath, catalogPath, claimsPath, payloadPath, uri, schemaUID string) {
	t.Helper()
	directory := t.TempDir()
	schema, err := xcs.ParseSchema([]byte(claimsTestSchema))
	if err != nil {
		t.Fatal(err)
	}
	ledgerHash := strings.Repeat("a", 64)
	schemaUID, _, err = xcs.ComputeSchemaUID(xcs.SchemaUIDInput{
		NetworkID: 1, LedgerHash: ledgerHash, LedgerIndex: 10, TransactionIndex: 0,
		Publisher: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh", Schema: schema,
	})
	if err != nil {
		t.Fatal(err)
	}
	bundle := xcs.SchemaCatalogBundleV1{
		Format: xcs.SchemaCatalogFormatV1,
		Profile: xcs.NetworkProfile{
			ProfileID: "xrpl-testnet-xcs-v0.1-cli-test", XCSVersion: "0.1", NetworkID: 1,
			RequiredAmendment: strings.Repeat("A", 64),
			RegistryAddress:   "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh", RegistrationAmountDrops: "1",
			ActivationLedgerIndex: 9, ActivationLedgerHash: strings.Repeat("9", 64),
		},
		TargetUID:  schemaUID,
		Checkpoint: xcs.SchemaCatalogCheckpointV1{LedgerIndex: 10, LedgerHash: ledgerHash},
		Schemas: []xcs.SchemaCatalogEntryV1{{
			UID: schemaUID, Definition: schema, Publisher: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
			LedgerIndex: 10, LedgerHash: ledgerHash, TransactionIndex: 0,
			TransactionHash: strings.Repeat("b", 64),
		}},
	}
	catalogData, err := json.Marshal(bundle)
	if err != nil {
		t.Fatal(err)
	}
	payload, err := xcs.Canonicalize(map[string]any{
		"xcsVersion": "0.1", "issuer": "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
		"subject": "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh", "schema": schemaUID,
		"claims": map[string]any{"bib": "42"},
	})
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(payload)
	uri = "https://example.com/credential#xcs-sha256=" + hex.EncodeToString(digest[:])
	return writeTestFile(t, directory, "schema.json", []byte(claimsTestSchema)),
		writeTestFile(t, directory, "catalog.json", catalogData),
		writeTestFile(t, directory, "claims.json", []byte(`{"bib":"42"}`)),
		writeTestFile(t, directory, "payload.json", payload), uri, schemaUID
}

func TestVerifierProcessReadsCatalogForClaimsAndPayload(t *testing.T) {
	binary := buildVerifierProcess(t)
	_, catalogPath, claimsPath, payloadPath, uri, schemaUID := processFixture(t)

	for name, args := range map[string][]string{
		"catalog": {"catalog", catalogPath},
		"claims":  {"claims", "--catalog", catalogPath, claimsPath},
		"payload": {"payload", "--catalog", catalogPath, payloadPath, uri,
			"rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh", "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh", schemaUID},
	} {
		t.Run(name, func(t *testing.T) {
			command := exec.Command(binary, args...)
			output, err := command.CombinedOutput()
			if err != nil {
				t.Fatalf("command failed: %v\n%s", err, output)
			}
			var result map[string]any
			if err := json.Unmarshal(output, &result); err != nil || result["valid"] != true {
				t.Fatalf("unexpected command result: %s (%v)", output, err)
			}
			if name == "catalog" {
				if result["validationScope"] != "internal-consistency" || result["xrplRegistrationVerified"] != false {
					t.Fatalf("catalog result must disclose its verification scope: %s", output)
				}
			}
		})
	}
}

func TestVerifierPayloadTamperingExitsOneWithInvalidResult(t *testing.T) {
	binary := buildVerifierProcess(t)
	schemaPath, _, _, payloadPath, _, schemaUID := processFixture(t)
	command := exec.Command(binary, "payload", schemaPath, payloadPath,
		"https://example.com/credential#xcs-sha256="+strings.Repeat("0", 64),
		"rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh", "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh", schemaUID)
	output, err := command.Output()
	var exitError *exec.ExitError
	if !errors.As(err, &exitError) || exitError.ExitCode() != 1 {
		t.Fatalf("expected process exit code 1, got %v", err)
	}
	if len(exitError.Stderr) != 0 {
		t.Fatalf("tampering result must not be reported as an internal error: %s", exitError.Stderr)
	}
	var result struct {
		Valid bool `json:"valid"`
	}
	if err := json.Unmarshal(output, &result); err != nil {
		t.Fatalf("decode process output: %v (%s)", err, output)
	}
	if result.Valid {
		t.Fatalf("expected valid:false, got %s", output)
	}
}
