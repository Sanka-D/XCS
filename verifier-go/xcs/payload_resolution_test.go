package xcs

import "testing"

func inheritedPayloadFixture(t *testing.T, claims map[string]any) ([]byte, PayloadContext) {
	t.Helper()
	issuer := resolutionPublisherA
	subject := resolutionPublisherB
	schemaUID := resolutionUID(401)
	parentUID := resolutionUID(400)
	parent := RegisteredSchema{
		UID: parentUID,
		Definition: resolutionSchema("Payload parent", "", "", map[string]FieldDescriptor{
			"courseId": {Type: "string"},
		}),
		Publisher:        resolutionPublisherB,
		NetworkID:        1,
		LedgerIndex:      10,
		TransactionIndex: 1,
	}
	child := resolutionSchema("Payload child", parentUID, "", map[string]FieldDescriptor{
		"completed": {Type: "bool"},
	})
	catalog := map[string]RegisteredSchema{parentUID: parent}
	resolutionContext := &SchemaResolutionContext{
		NetworkID:        1,
		Publisher:        resolutionPublisherA,
		LedgerIndex:      11,
		TransactionIndex: 0,
		GetSchema:        resolutionLookup(catalog),
	}
	content, err := Canonicalize(map[string]any{
		"xcsVersion": "0.1",
		"issuer":     issuer,
		"subject":    subject,
		"schema":     schemaUID,
		"claims":     claims,
	})
	if err != nil {
		t.Fatal(err)
	}
	return content, PayloadContext{
		Issuer:            issuer,
		Subject:           subject,
		SchemaUID:         schemaUID,
		Schema:            child,
		ResolutionContext: resolutionContext,
	}
}

func TestParseCredentialPayloadValidatesInheritedClaimsWithResolutionContext(t *testing.T) {
	content, context := inheritedPayloadFixture(t, map[string]any{
		"courseId":  "course-1",
		"completed": true,
	})

	payload, err := ParseCredentialPayload(content, context)
	if err != nil {
		t.Fatal(err)
	}
	if payload.Claims["courseId"] != "course-1" || payload.Claims["completed"] != true {
		t.Fatalf("unexpected inherited claims: %#v", payload.Claims)
	}
}

func TestParseCredentialPayloadKeepsInheritedSchemasFailClosedWithoutResolutionContext(t *testing.T) {
	content, context := inheritedPayloadFixture(t, map[string]any{
		"courseId":  "course-1",
		"completed": true,
	})
	context.ResolutionContext = nil

	_, err := ParseCredentialPayload(content, context)
	requireResolutionErrorCode(t, err, "SCHEMA_PARENT_NOT_FOUND")
}

func TestParseCredentialPayloadRejectsClaimsMissingAnInheritedField(t *testing.T) {
	content, context := inheritedPayloadFixture(t, map[string]any{
		"completed": true,
	})

	_, err := ParseCredentialPayload(content, context)
	requireResolutionErrorCode(t, err, "CLAIMS_INVALID")
}

func TestParseCredentialPayloadRejectsAnIncompleteResolutionCatalog(t *testing.T) {
	content, context := inheritedPayloadFixture(t, map[string]any{
		"courseId":  "course-1",
		"completed": true,
	})
	context.ResolutionContext.GetSchema = resolutionLookup(nil)

	_, err := ParseCredentialPayload(content, context)
	requireResolutionErrorCode(t, err, "SCHEMA_PARENT_NOT_FOUND")
}
