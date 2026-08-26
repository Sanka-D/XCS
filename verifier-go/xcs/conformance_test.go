package xcs

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
)

func TestConformanceVectors(t *testing.T) {
	suite, err := loadConformanceSuite(conformanceDirectory())
	if err != nil {
		t.Fatal(err)
	}
	if suite.Manifest.FormatVersion != 1 || suite.Manifest.ProtocolVersion != "0.1" || suite.Manifest.Revision != 9 {
		t.Fatalf("unexpected frozen manifest metadata: %+v", suite.Manifest)
	}

	consumed := make(map[conformanceHandler]bool, len(suite.Files))
	for _, file := range suite.Files {
		var run func(*testing.T, []byte)
		switch file.Handler {
		case canonicalizationHandler:
			run = runCanonicalizationVectors
		case schemaValidationHandler:
			run = runSchemaValidationVectors
		case schemaResolutionHandler:
			run = runSchemaResolutionVectors
		case rippleTimeHandler:
			run = runRippleTimeVectors
		case lifecycleStateHandler:
			run = runLifecycleStateVectors
		case schemaUIDHandler:
			run = runSchemaUIDVectors
		case claimsHandler:
			run = runClaimVectors
		case payloadIntegrityHandler:
			run = runPayloadIntegrityVectors
		case payloadRetrievalHandler:
			run = runPayloadRetrievalVectors
		case payloadValidationHandler:
			run = runPayloadValidationVectors
		default:
			t.Fatalf("no consumer for conformance handler %s", file.Handler)
		}
		consumed[file.Handler] = true
		t.Run(string(file.Handler), func(t *testing.T) {
			run(t, file.Data)
		})
	}
	if len(consumed) != len(suite.Files) {
		t.Fatalf("not every declared conformance file was consumed: %d/%d", len(consumed), len(suite.Files))
	}
}

func runSchemaValidationVectors(t *testing.T, data []byte) {
	t.Helper()
	var vectors struct {
		Cases []struct {
			ID        string `json:"id"`
			Name      string `json:"name"`
			Valid     bool   `json:"valid"`
			ErrorCode string `json:"errorCode"`
			InputJSON string `json:"inputJson"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(data, &vectors); err != nil {
		t.Fatal(err)
	}
	for _, vector := range vectors.Cases {
		t.Run(vector.ID+" "+vector.Name, func(t *testing.T) {
			_, err := ParseSchema([]byte(vector.InputJSON))
			if vector.Valid {
				if err != nil {
					t.Fatalf("expected valid schema: %v", err)
				}
				return
			}
			var xcsError *Error
			if !errors.As(err, &xcsError) || xcsError.Code != vector.ErrorCode {
				t.Fatalf("expected %s, got %v", vector.ErrorCode, err)
			}
		})
	}
}

func runCanonicalizationVectors(t *testing.T, data []byte) {
	t.Helper()
	var vectors struct {
		Cases []struct {
			ID        string `json:"id"`
			Name      string `json:"name"`
			InputJSON string `json:"inputJson"`
			Canonical string `json:"canonical"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(data, &vectors); err != nil {
		t.Fatal(err)
	}
	for _, vector := range vectors.Cases {
		t.Run(vector.ID+" "+vector.Name, func(t *testing.T) {
			parsed, err := ParseJSON([]byte(vector.InputJSON))
			if err != nil {
				t.Fatal(err)
			}
			canonical, err := Canonicalize(parsed)
			if err != nil {
				t.Fatal(err)
			}
			if string(canonical) != vector.Canonical {
				t.Fatalf("canonical mismatch\nwant %s\ngot  %s", vector.Canonical, canonical)
			}
		})
	}
}

func TestStrictJSONRejectsDuplicateKeys(t *testing.T) {
	_, err := ParseJSON([]byte(`{"a":1,"a":2}`))
	var xcsError *Error
	if !errors.As(err, &xcsError) || xcsError.Code != "JSON_DUPLICATE_KEY" {
		t.Fatalf("expected JSON_DUPLICATE_KEY, got %v", err)
	}
}

func TestStrictJSONRejectsUnpairedSurrogates(t *testing.T) {
	_, err := ParseJSON([]byte(`"\ud800"`))
	var xcsError *Error
	if !errors.As(err, &xcsError) || xcsError.Code != "JSON_INVALID_UNICODE" {
		t.Fatalf("expected JSON_INVALID_UNICODE, got %v", err)
	}
}

func runSchemaUIDVectors(t *testing.T, data []byte) {
	t.Helper()
	var vectors struct {
		Cases []struct {
			ID                string          `json:"id"`
			Name              string          `json:"name"`
			Valid             bool            `json:"valid"`
			ErrorCode         string          `json:"errorCode"`
			Input             json.RawMessage `json:"input"`
			CanonicalPreimage string          `json:"canonicalPreimage"`
			UID               string          `json:"uid"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(data, &vectors); err != nil {
		t.Fatal(err)
	}
	for _, vector := range vectors.Cases {
		t.Run(vector.ID+" "+vector.Name, func(t *testing.T) {
			input, err := ParseSchemaUIDInput(vector.Input)
			if !vector.Valid {
				if err == nil {
					_, _, err = ComputeSchemaUID(input)
				}
				var xcsError *Error
				if !errors.As(err, &xcsError) || xcsError.Code != vector.ErrorCode {
					t.Fatalf("expected %s, got %v", vector.ErrorCode, err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			uid, canonical, err := ComputeSchemaUID(input)
			if err != nil {
				t.Fatal(err)
			}
			if uid != vector.UID {
				t.Fatalf("UID mismatch: want %s, got %s", vector.UID, uid)
			}
			if string(canonical) != vector.CanonicalPreimage {
				t.Fatalf("preimage mismatch\nwant %s\ngot  %s", vector.CanonicalPreimage, canonical)
			}
		})
	}
}

func TestSchemaUIDInputRequiresPresentNumericFields(t *testing.T) {
	schema := SchemaDefinition{
		XCSVersion: "0.1", Name: "Course", Description: "Course completion",
		Fields: map[string]FieldDescriptor{"programId": {Type: "string"}},
	}
	for _, field := range []string{"networkId", "ledgerIndex", "transactionIndex"} {
		for _, variant := range []string{"missing", "null"} {
			t.Run(field+"_"+variant, func(t *testing.T) {
				input := map[string]any{
					"networkId":        0,
					"ledgerHash":       "abababababababababababababababababababababababababababababababab",
					"ledgerIndex":      0,
					"transactionIndex": 0,
					"publisher":        "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
					"schema":           schemaMap(schema),
				}
				if variant == "missing" {
					delete(input, field)
				} else {
					input[field] = nil
				}
				encoded, err := json.Marshal(input)
				if err != nil {
					t.Fatal(err)
				}
				_, err = ParseSchemaUIDInput(encoded)
				var xcsError *Error
				if !errors.As(err, &xcsError) || xcsError.Code != "UID_INPUT_INVALID" {
					t.Fatalf("expected UID_INPUT_INVALID, got %v", err)
				}
			})
		}
	}
}

func runClaimVectors(t *testing.T, data []byte) {
	t.Helper()
	var vectors struct {
		Schema SchemaDefinition `json:"schema"`
		Cases  []struct {
			ID        string          `json:"id"`
			Name      string          `json:"name"`
			Valid     bool            `json:"valid"`
			ErrorCode string          `json:"errorCode"`
			Claims    json.RawMessage `json:"claims"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(data, &vectors); err != nil {
		t.Fatal(err)
	}
	if err := ValidateSchema(vectors.Schema); err != nil {
		t.Fatal(err)
	}
	for _, vector := range vectors.Cases {
		t.Run(vector.ID+" "+vector.Name, func(t *testing.T) {
			parsed, err := ParseJSON(vector.Claims)
			if err != nil {
				t.Fatal(err)
			}
			err = ValidateClaims(parsed, vectors.Schema.Fields)
			if vector.Valid && err != nil {
				t.Fatalf("expected valid claims: %v", err)
			}
			if !vector.Valid {
				var xcsError *Error
				if !errors.As(err, &xcsError) || xcsError.Code != vector.ErrorCode {
					t.Fatalf("expected %s, got %v", vector.ErrorCode, err)
				}
			}
		})
	}
}

func TestSchemaRejectsControlCharacters(t *testing.T) {
	schema := SchemaDefinition{
		XCSVersion: "0.1", Name: "unsafe\x00name", Description: "description",
		Fields: map[string]FieldDescriptor{"value": {Type: "string"}},
	}
	if err := ValidateSchema(schema); err == nil {
		t.Fatal("expected control-character rejection")
	}
}

func TestParsedSchemaRejectsNullCompositePropertiesOnScalar(t *testing.T) {
	_, err := ParseSchema([]byte(`{"xcsVersion":"0.1","name":"Name","description":"Description","fields":{"value":{"type":"string","items":null}}}`))
	if err == nil {
		t.Fatal("expected scalar items property rejection")
	}
}

func TestParsedSchemaRejectsNullOptionalAndRelations(t *testing.T) {
	cases := map[string]string{
		"optional":      `{"xcsVersion":"0.1","name":"Name","description":"Description","fields":{"value":{"type":"string","optional":null}}}`,
		"extends":       `{"xcsVersion":"0.1","name":"Name","description":"Description","extends":null,"fields":{"value":{"type":"string"}}}`,
		"empty extends": `{"xcsVersion":"0.1","name":"Name","description":"Description","extends":"","fields":{"value":{"type":"string"}}}`,
		"supersedes":    `{"xcsVersion":"0.1","name":"Name","description":"Description","supersedes":null,"fields":{"value":{"type":"string"}}}`,
	}
	for name, input := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := ParseSchema([]byte(input))
			var xcsError *Error
			if !errors.As(err, &xcsError) || xcsError.Code != "SCHEMA_INVALID" {
				t.Fatalf("expected SCHEMA_INVALID, got %v", err)
			}
		})
	}
}

func TestSchemaCountsArrayItemDescriptors(t *testing.T) {
	fields := make(map[string]FieldDescriptor, 128)
	for index := 0; index < 128; index++ {
		items := FieldDescriptor{Type: "string"}
		fields[fmt.Sprintf("field_%d", index)] = FieldDescriptor{Type: "array", Items: &items}
	}
	schema := SchemaDefinition{
		XCSVersion: "0.1", Name: "At the descriptor limit", Description: "Array item descriptors count",
		Fields: fields,
	}
	if err := ValidateSchema(schema); err != nil {
		t.Fatalf("expected exactly 256 descriptors to be valid: %v", err)
	}

	items := FieldDescriptor{Type: "string"}
	schema.Fields["field_128"] = FieldDescriptor{Type: "array", Items: &items}
	err := ValidateSchema(schema)
	var xcsError *Error
	if !errors.As(err, &xcsError) || xcsError.Code != "SCHEMA_FIELD_LIMIT_EXCEEDED" {
		t.Fatalf("expected SCHEMA_FIELD_LIMIT_EXCEEDED, got %v", err)
	}
}

func runPayloadIntegrityVectors(t *testing.T, data []byte) {
	t.Helper()
	var vectors struct {
		Version string `json:"version"`
		Cases   []struct {
			ID            string `json:"id"`
			Name          string `json:"name"`
			ContentUTF8   string `json:"contentUtf8"`
			ContentBase64 string `json:"contentBase64"`
			ContentRepeat *struct {
				Value string `json:"value"`
				Count int    `json:"count"`
			} `json:"contentRepeat"`
			ErrorCode      string `json:"errorCode"`
			SHA256         string `json:"sha256"`
			ExpectedSHA256 string `json:"expectedSha256"`
			ActualSHA256   string `json:"actualSha256"`
			FetchURL       string `json:"fetchUrl"`
			Status         string `json:"status"`
			URI            string `json:"uri"`
			Derive         bool   `json:"derive"`
		} `json:"cases"`
	}
	if err := decodeStrictJSON(data, &vectors); err != nil {
		t.Fatal(err)
	}
	if vectors.Version != "0.1" {
		t.Fatalf("unexpected payload-integrity vector version %q", vectors.Version)
	}
	for _, vector := range vectors.Cases {
		t.Run(vector.ID+" "+vector.Name, func(t *testing.T) {
			if vector.ContentBase64 != "" {
				content, decodeErr := base64.StdEncoding.DecodeString(vector.ContentBase64)
				if decodeErr != nil {
					t.Fatal(decodeErr)
				}
				_, err := ParseCredentialPayload(content, PayloadContext{})
				var xcsError *Error
				if !errors.As(err, &xcsError) || xcsError.Code != vector.ErrorCode {
					t.Fatalf("expected %s, got %v", vector.ErrorCode, err)
				}
				return
			}
			content := vector.ContentUTF8
			if vector.ContentRepeat != nil {
				if vector.ContentRepeat.Count < 0 {
					t.Fatal("contentRepeat count must be non-negative")
				}
				content = strings.Repeat(vector.ContentRepeat.Value, vector.ContentRepeat.Count)
			}
			if vector.ErrorCode != "" {
				_, _, _, err := VerifyPayloadIntegrity([]byte(content), vector.URI)
				var xcsError *Error
				if !errors.As(err, &xcsError) || xcsError.Code != vector.ErrorCode {
					t.Fatalf("expected %s, got %v", vector.ErrorCode, err)
				}
				return
			}
			valid, expected, actual, err := VerifyPayloadIntegrity([]byte(content), vector.URI)
			if err != nil {
				t.Fatal(err)
			}
			status := vector.Status
			if status == "" {
				status = "valid"
			}
			if status != "valid" && status != "tampered" {
				t.Fatalf("unknown payload integrity status %q", status)
			}
			expectedSHA256 := vector.ExpectedSHA256
			if expectedSHA256 == "" {
				expectedSHA256 = vector.SHA256
			}
			actualSHA256 := vector.ActualSHA256
			if actualSHA256 == "" {
				actualSHA256 = vector.SHA256
			}
			if valid != (status == "valid") || expected != expectedSHA256 || actual != actualSHA256 {
				t.Fatalf("integrity mismatch: valid=%v expected=%s actual=%s", valid, expected, actual)
			}
			if vector.FetchURL != "" {
				parsed, parseErr := InspectPayloadURI(vector.URI)
				if parseErr != nil {
					t.Fatal(parseErr)
				}
				if parsed.FetchURL != vector.FetchURL {
					t.Fatalf("fetch URL mismatch: got %q want %q", parsed.FetchURL, vector.FetchURL)
				}
			}
		})
	}
}

func TestInspectPayloadURIRejectsInvalidUTF8(t *testing.T) {
	rawURI := "https://issuer.example/credentials/" + string([]byte{0xff}) +
		".json#xcs-sha256=2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
	_, err := InspectPayloadURI(rawURI)
	var xcsError *Error
	if !errors.As(err, &xcsError) || xcsError.Code != "PAYLOAD_URI_INVALID" {
		t.Fatalf("expected PAYLOAD_URI_INVALID, got %v", err)
	}
}

func runPayloadRetrievalVectors(t *testing.T, data []byte) {
	t.Helper()
	type payloadRetrievalContext struct {
		Issuer    string           `json:"issuer"`
		Subject   string           `json:"subject"`
		SchemaUID string           `json:"schemaUid"`
		Schema    SchemaDefinition `json:"schema"`
	}
	type contentSegments struct {
		PrefixUTF8 string `json:"prefixUtf8"`
		Repeat     struct {
			Value string `json:"value"`
			Count int    `json:"count"`
		} `json:"repeat"`
		SuffixUTF8 string `json:"suffixUtf8"`
	}
	var vectors struct {
		Version string                  `json:"version"`
		Context payloadRetrievalContext `json:"context"`
		Cases   []struct {
			ID        string `json:"id"`
			Name      string `json:"name"`
			Retrieval struct {
				Status          string           `json:"status"`
				ContentUTF8     *string          `json:"contentUtf8"`
				ContentSegments *contentSegments `json:"contentSegments"`
			} `json:"retrieval"`
			URI        string                    `json:"uri"`
			ByteLength *int                      `json:"byteLength"`
			Status     PayloadVerificationStatus `json:"status"`
		} `json:"cases"`
	}
	if err := decodeStrictJSON(data, &vectors); err != nil {
		t.Fatal(err)
	}
	if vectors.Version != "0.1" {
		t.Fatalf("unexpected payload-retrieval vector version %q", vectors.Version)
	}
	if err := ValidateSchema(vectors.Context.Schema); err != nil {
		t.Fatal(err)
	}
	context := PayloadContext{
		Issuer: vectors.Context.Issuer, Subject: vectors.Context.Subject,
		SchemaUID: vectors.Context.SchemaUID, Schema: vectors.Context.Schema,
	}
	for _, vector := range vectors.Cases {
		t.Run(vector.ID+" "+vector.Name, func(t *testing.T) {
			var content []byte
			switch vector.Retrieval.Status {
			case "unavailable":
				if vector.Retrieval.ContentUTF8 != nil || vector.Retrieval.ContentSegments != nil {
					t.Fatal("unavailable retrieval must not carry content")
				}
			case "retrieved":
				if (vector.Retrieval.ContentUTF8 == nil) == (vector.Retrieval.ContentSegments == nil) {
					t.Fatal("retrieved evidence must carry exactly one content representation")
				}
				if vector.Retrieval.ContentUTF8 != nil {
					content = []byte(*vector.Retrieval.ContentUTF8)
				} else {
					segments := vector.Retrieval.ContentSegments
					if segments.Repeat.Count < 0 {
						t.Fatal("content repeat count must be non-negative")
					}
					content = []byte(segments.PrefixUTF8 + strings.Repeat(segments.Repeat.Value, segments.Repeat.Count) + segments.SuffixUTF8)
				}
			default:
				t.Fatalf("unknown retrieval status %q", vector.Retrieval.Status)
			}
			if vector.ByteLength != nil && len(content) != *vector.ByteLength {
				t.Fatalf("content length mismatch: got %d want %d", len(content), *vector.ByteLength)
			}
			if vector.Status != PayloadValid && vector.Status != PayloadUnavailable && vector.Status != PayloadTampered && vector.Status != PayloadInvalid {
				t.Fatalf("unknown expected payload status %q", vector.Status)
			}
			actual := ClassifyCredentialPayload(PayloadRetrievalEvidence{
				Status: vector.Retrieval.Status, Content: content,
			}, vector.URI, context)
			if actual != vector.Status {
				t.Fatalf("payload status mismatch: got %q want %q", actual, vector.Status)
			}
		})
	}
}

func runPayloadValidationVectors(t *testing.T, data []byte) {
	t.Helper()
	type payloadVectorContext struct {
		Issuer    string           `json:"issuer"`
		Subject   string           `json:"subject"`
		SchemaUID string           `json:"schemaUid"`
		Schema    SchemaDefinition `json:"schema"`
	}
	var vectors struct {
		Version          string               `json:"version"`
		Context          payloadVectorContext `json:"context"`
		InheritedContext struct {
			payloadVectorContext
			Resolution schemaResolutionContextVector   `json:"resolution"`
			Catalog    []schemaResolutionCatalogVector `json:"catalog"`
		} `json:"inheritedContext"`
		Cases []struct {
			ID             string                          `json:"id"`
			Name           string                          `json:"name"`
			Context        string                          `json:"context"`
			Catalog        []schemaResolutionCatalogVector `json:"catalog"`
			Valid          bool                            `json:"valid"`
			ExpectedClaims map[string]any                  `json:"expectedClaims"`
			ErrorCode      string                          `json:"errorCode"`
			InputJSON      string                          `json:"inputJson"`
		} `json:"cases"`
	}
	if err := decodeStrictJSON(data, &vectors); err != nil {
		t.Fatal(err)
	}
	if err := ValidateSchema(vectors.Context.Schema); err != nil {
		t.Fatal(err)
	}
	context := PayloadContext{
		Issuer: vectors.Context.Issuer, Subject: vectors.Context.Subject,
		SchemaUID: vectors.Context.SchemaUID, Schema: vectors.Context.Schema,
	}
	for _, vector := range vectors.Cases {
		t.Run(vector.ID+" "+vector.Name, func(t *testing.T) {
			caseContext := context
			if vector.Context == "inherited" {
				inherited := vectors.InheritedContext
				catalogEntries := inherited.Catalog
				if vector.Catalog != nil {
					catalogEntries = vector.Catalog
				}
				catalog := make(map[string]RegisteredSchema, len(catalogEntries))
				for _, entry := range catalogEntries {
					definition, parseErr := ParseSchema(entry.Definition)
					if parseErr != nil {
						t.Fatalf("parse inherited catalog schema %s: %v", entry.UID, parseErr)
					}
					catalog[entry.UID] = RegisteredSchema{
						UID: entry.UID, Definition: definition, Publisher: entry.Publisher,
						NetworkID: entry.NetworkID, LedgerIndex: entry.LedgerIndex,
						TransactionIndex: entry.TransactionIndex,
					}
				}
				resolution := &SchemaResolutionContext{
					NetworkID: inherited.Resolution.NetworkID, Publisher: inherited.Resolution.Publisher,
					LedgerIndex:      inherited.Resolution.LedgerIndex,
					TransactionIndex: inherited.Resolution.TransactionIndex,
					GetSchema: func(uid string) (RegisteredSchema, bool) {
						registered, found := catalog[uid]
						return registered, found
					},
				}
				caseContext = PayloadContext{
					Issuer: inherited.Issuer, Subject: inherited.Subject,
					SchemaUID: inherited.SchemaUID, Schema: inherited.Schema,
					ResolutionContext: resolution,
				}
			}
			payload, err := ParseCredentialPayload([]byte(vector.InputJSON), caseContext)
			if vector.Valid {
				if err != nil {
					t.Fatalf("expected valid payload: %v", err)
				}
				requireStructuralEqual(t, "payload claims", vector.ExpectedClaims, payload.Claims)
				return
			}
			var xcsError *Error
			if !errors.As(err, &xcsError) || xcsError.Code != vector.ErrorCode {
				t.Fatalf("expected %s, got %v", vector.ErrorCode, err)
			}
		})
	}
}

func TestCanonicalPayloadValidation(t *testing.T) {
	issuer := "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh"
	subject := "rG1QQv2nh2gr7RCZ1P8YYcBUKCCN633jCn"
	schemaUID := "abababababababababababababababababababababababababababababababab"
	schema := SchemaDefinition{
		XCSVersion: "0.1", Name: "Course", Description: "Course completion",
		Fields: map[string]FieldDescriptor{"programId": {Type: "string"}},
	}
	value := map[string]any{
		"xcsVersion": "0.1", "issuer": issuer, "subject": subject, "schema": schemaUID,
		"claims": map[string]any{"programId": "course-1"},
	}
	canonical, err := Canonicalize(value)
	if err != nil {
		t.Fatal(err)
	}
	context := PayloadContext{Issuer: issuer, Subject: subject, SchemaUID: schemaUID, Schema: schema}
	if _, err := ParseCredentialPayload(canonical, context); err != nil {
		t.Fatal(err)
	}
	pretty, _ := json.MarshalIndent(value, "", "  ")
	if _, err := ParseCredentialPayload(pretty, context); err == nil {
		t.Fatal("expected non-canonical payload rejection")
	}
}

func TestPayloadValidationRejectsUnresolvedInheritedSchema(t *testing.T) {
	issuer := "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh"
	subject := "rG1QQv2nh2gr7RCZ1P8YYcBUKCCN633jCn"
	schemaUID := "cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd"
	schema := SchemaDefinition{
		XCSVersion: "0.1", Name: "Child", Description: "Unresolved inherited schema",
		Extends: "abababababababababababababababababababababababababababababababab",
		Fields:  map[string]FieldDescriptor{"child": {Type: "string"}},
	}
	value := map[string]any{
		"xcsVersion": "0.1", "issuer": issuer, "subject": subject, "schema": schemaUID,
		"claims": map[string]any{"child": "present"},
	}
	canonical, err := Canonicalize(value)
	if err != nil {
		t.Fatal(err)
	}
	_, err = ParseCredentialPayload(canonical, PayloadContext{
		Issuer: issuer, Subject: subject, SchemaUID: schemaUID, Schema: schema,
	})
	var xcsError *Error
	if !errors.As(err, &xcsError) || xcsError.Code != "SCHEMA_PARENT_NOT_FOUND" {
		t.Fatalf("expected unresolved inheritance rejection, got %v", err)
	}
}

func TestClaimValidationRejectsUnresolvedInheritedSchema(t *testing.T) {
	schema := SchemaDefinition{
		XCSVersion: "0.1", Name: "Child", Description: "Unresolved inherited schema",
		Extends: "abababababababababababababababababababababababababababababababab",
		Fields:  map[string]FieldDescriptor{"child": {Type: "string"}},
	}
	err := ValidateClaimsAgainstSchema(map[string]any{"child": "present"}, schema)
	var xcsError *Error
	if !errors.As(err, &xcsError) || xcsError.Code != "SCHEMA_PARENT_NOT_FOUND" {
		t.Fatalf("expected unresolved inheritance rejection, got %v", err)
	}
}
