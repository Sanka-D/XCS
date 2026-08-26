package xcs

import (
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"testing"
)

const (
	resolutionPublisherA = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh"
	resolutionPublisherB = "rG1QQv2nh2gr7RCZ1P8YYcBUKCCN633jCn"
)

func resolutionUID(index int) string {
	return fmt.Sprintf("%064x", index)
}

func resolutionSchema(
	name string,
	extends string,
	supersedes string,
	fields map[string]FieldDescriptor,
) SchemaDefinition {
	return SchemaDefinition{
		XCSVersion:  "0.1",
		Name:        name,
		Description: "Schema resolution test fixture",
		Extends:     extends,
		Supersedes:  supersedes,
		Fields:      fields,
	}
}

func resolutionLookup(catalog map[string]RegisteredSchema) func(string) (RegisteredSchema, bool) {
	return func(uid string) (RegisteredSchema, bool) {
		schema, found := catalog[uid]
		return schema, found
	}
}

func requireResolutionErrorCode(t *testing.T, err error, code string) {
	t.Helper()
	var protocolError *Error
	if !errors.As(err, &protocolError) || protocolError.Code != code {
		t.Fatalf("expected %s, got %v", code, err)
	}
}

func resolutionSnapshot(t *testing.T, value any) []byte {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return encoded
}

func TestResolveSchemaMergesMultiPublisherLineageWithoutMutation(t *testing.T) {
	rootUID := resolutionUID(1)
	middleUID := resolutionUID(2)
	root := RegisteredSchema{
		UID:              rootUID,
		Publisher:        resolutionPublisherA,
		NetworkID:        1,
		LedgerIndex:      10,
		TransactionIndex: 1,
		Definition: resolutionSchema("Root", "", "", map[string]FieldDescriptor{
			"rootItems": {Type: "array", Items: &FieldDescriptor{Type: "string"}},
		}),
	}
	middle := RegisteredSchema{
		UID:              middleUID,
		Publisher:        resolutionPublisherB,
		NetworkID:        1,
		LedgerIndex:      10,
		TransactionIndex: 2,
		Definition: resolutionSchema("Middle", rootUID, "", map[string]FieldDescriptor{
			"middleFlag": {Type: "bool"},
		}),
	}
	child := resolutionSchema("Child", middleUID, "", map[string]FieldDescriptor{
		"childCount": {Type: "uint"},
	})
	catalog := map[string]RegisteredSchema{rootUID: root, middleUID: middle}
	snapshot := resolutionSnapshot(t, struct {
		Schema  SchemaDefinition
		Catalog map[string]RegisteredSchema
	}{Schema: child, Catalog: catalog})

	resolved, err := ResolveSchema(child, SchemaResolutionContext{
		NetworkID:        1,
		Publisher:        resolutionPublisherA,
		LedgerIndex:      11,
		TransactionIndex: 0,
		GetSchema:        resolutionLookup(catalog),
	})
	if err != nil {
		t.Fatal(err)
	}

	if !reflect.DeepEqual(resolved.Lineage, []string{rootUID, middleUID}) {
		t.Fatalf("unexpected lineage: %#v", resolved.Lineage)
	}
	if !reflect.DeepEqual(resolved.Definition, child) {
		t.Fatalf("resolved definition changed\nwant %#v\ngot  %#v", child, resolved.Definition)
	}
	if len(resolved.Fields) != 3 ||
		resolved.Fields["rootItems"].Type != "array" ||
		resolved.Fields["middleFlag"].Type != "bool" ||
		resolved.Fields["childCount"].Type != "uint" {
		t.Fatalf("unexpected resolved fields: %#v", resolved.Fields)
	}
	if after := resolutionSnapshot(t, struct {
		Schema  SchemaDefinition
		Catalog map[string]RegisteredSchema
	}{Schema: child, Catalog: catalog}); !reflect.DeepEqual(after, snapshot) {
		t.Fatal("resolution mutated its schema or catalog inputs")
	}

	rootItems := resolved.Fields["rootItems"]
	rootItems.Items.Type = "bool"
	resolved.Fields["rootItems"] = rootItems
	if catalog[rootUID].Definition.Fields["rootItems"].Items.Type != "string" {
		t.Fatal("resolved descriptors alias catalog descriptors")
	}
	resolved.Definition.Fields["childCount"] = FieldDescriptor{Type: "bool"}
	if child.Fields["childCount"].Type != "uint" {
		t.Fatal("resolved definition aliases the input definition")
	}
}

func TestResolveSchemaRejectsInvalidInheritance(t *testing.T) {
	parentUID := resolutionUID(10)
	parent := RegisteredSchema{
		UID:              parentUID,
		Definition:       resolutionSchema("Parent", "", "", map[string]FieldDescriptor{"shared": {Type: "string"}}),
		Publisher:        resolutionPublisherA,
		NetworkID:        1,
		LedgerIndex:      10,
		TransactionIndex: 1,
	}
	child := resolutionSchema("Child", parentUID, "", map[string]FieldDescriptor{"child": {Type: "bool"}})
	baseContext := SchemaResolutionContext{
		NetworkID:        1,
		Publisher:        resolutionPublisherA,
		LedgerIndex:      11,
		TransactionIndex: 0,
	}

	tests := []struct {
		name    string
		schema  SchemaDefinition
		context SchemaResolutionContext
		code    string
	}{
		{
			name:   "missing parent",
			schema: child,
			context: func() SchemaResolutionContext {
				context := baseContext
				context.GetSchema = resolutionLookup(nil)
				return context
			}(),
			code: "SCHEMA_PARENT_NOT_FOUND",
		},
		{
			name:   "mismatched returned uid",
			schema: child,
			context: func() SchemaResolutionContext {
				context := baseContext
				context.GetSchema = func(string) (RegisteredSchema, bool) {
					mismatched := parent
					mismatched.UID = resolutionUID(11)
					return mismatched, true
				}
				return context
			}(),
			code: "SCHEMA_PARENT_NOT_FOUND",
		},
		{
			name:   "network mismatch",
			schema: child,
			context: func() SchemaResolutionContext {
				context := baseContext
				mismatched := parent
				mismatched.NetworkID = 2
				context.GetSchema = resolutionLookup(map[string]RegisteredSchema{parentUID: mismatched})
				return context
			}(),
			code: "SCHEMA_PARENT_NETWORK_MISMATCH",
		},
		{
			name:   "parent not prior",
			schema: child,
			context: func() SchemaResolutionContext {
				context := baseContext
				notPrior := parent
				notPrior.LedgerIndex = context.LedgerIndex
				notPrior.TransactionIndex = context.TransactionIndex
				context.GetSchema = resolutionLookup(map[string]RegisteredSchema{parentUID: notPrior})
				return context
			}(),
			code: "SCHEMA_PARENT_NOT_PRIOR",
		},
		{
			name: "inherited override",
			schema: resolutionSchema("Override", parentUID, "", map[string]FieldDescriptor{
				"shared": {Type: "bool"},
			}),
			context: func() SchemaResolutionContext {
				context := baseContext
				context.GetSchema = resolutionLookup(map[string]RegisteredSchema{parentUID: parent})
				return context
			}(),
			code: "SCHEMA_OVERRIDE_FORBIDDEN",
		},
		{
			name:   "self cycle",
			schema: child,
			context: func() SchemaResolutionContext {
				context := baseContext
				cyclic := parent
				cyclic.Definition.Extends = parentUID
				context.GetSchema = resolutionLookup(map[string]RegisteredSchema{parentUID: cyclic})
				return context
			}(),
			code: "SCHEMA_INHERITANCE_CYCLE",
		},
		{
			name:    "missing lookup",
			schema:  resolutionSchema("Root", "", "", map[string]FieldDescriptor{"value": {Type: "string"}}),
			context: baseContext,
			code:    "SCHEMA_INVALID",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := ResolveSchema(test.schema, test.context)
			requireResolutionErrorCode(t, err, test.code)
		})
	}
}

func resolutionChain(ancestorCount int) (SchemaDefinition, map[string]RegisteredSchema, SchemaResolutionContext) {
	catalog := make(map[string]RegisteredSchema, ancestorCount)
	lineageUIDs := make([]string, 0, ancestorCount)
	for level := 0; level < ancestorCount; level++ {
		uid := resolutionUID(100 + level)
		parentUID := ""
		if level > 0 {
			parentUID = lineageUIDs[level-1]
		}
		catalog[uid] = RegisteredSchema{
			UID:              uid,
			Definition:       resolutionSchema(fmt.Sprintf("Level %d", level), parentUID, "", map[string]FieldDescriptor{fmt.Sprintf("level_%d", level): {Type: "string"}}),
			Publisher:        resolutionPublisherA,
			NetworkID:        1,
			LedgerIndex:      uint32(level + 1),
			TransactionIndex: 0,
		}
		lineageUIDs = append(lineageUIDs, uid)
	}
	target := resolutionSchema("Target", lineageUIDs[len(lineageUIDs)-1], "", map[string]FieldDescriptor{
		"target": {Type: "string"},
	})
	return target, catalog, SchemaResolutionContext{
		NetworkID:        1,
		Publisher:        resolutionPublisherA,
		LedgerIndex:      uint32(ancestorCount + 1),
		TransactionIndex: 0,
		GetSchema:        resolutionLookup(catalog),
	}
}

func TestResolveSchemaEnforcesInheritanceDepthBoundary(t *testing.T) {
	allowed, allowedCatalog, allowedContext := resolutionChain(15)
	resolved, err := ResolveSchema(allowed, allowedContext)
	if err != nil {
		t.Fatal(err)
	}
	if len(resolved.Lineage) != 15 || len(resolved.Fields) != 16 {
		t.Fatalf("unexpected allowed boundary result: lineage=%d fields=%d catalog=%d", len(resolved.Lineage), len(resolved.Fields), len(allowedCatalog))
	}

	rejected, _, rejectedContext := resolutionChain(16)
	_, err = ResolveSchema(rejected, rejectedContext)
	requireResolutionErrorCode(t, err, "SCHEMA_DEPTH_EXCEEDED")
}

func resolutionArrayFields(prefix string, count int) map[string]FieldDescriptor {
	fields := make(map[string]FieldDescriptor, count)
	for index := 0; index < count; index++ {
		fields[fmt.Sprintf("%s_%d", prefix, index)] = FieldDescriptor{
			Type:  "array",
			Items: &FieldDescriptor{Type: "string"},
		}
	}
	return fields
}

func TestResolveSchemaEnforcesResolvedDescriptorBoundary(t *testing.T) {
	parentUID := resolutionUID(200)

	t.Run("accepts 256", func(t *testing.T) {
		parent := RegisteredSchema{
			UID:              parentUID,
			Definition:       resolutionSchema("Parent 254", "", "", resolutionArrayFields("parent", 127)),
			Publisher:        resolutionPublisherA,
			NetworkID:        1,
			LedgerIndex:      1,
			TransactionIndex: 0,
		}
		child := resolutionSchema("Child 2", parentUID, "", map[string]FieldDescriptor{
			"child_a": {Type: "string"},
			"child_b": {Type: "bool"},
		})
		resolved, err := ResolveSchema(child, SchemaResolutionContext{
			NetworkID:        1,
			Publisher:        resolutionPublisherA,
			LedgerIndex:      2,
			TransactionIndex: 0,
			GetSchema:        resolutionLookup(map[string]RegisteredSchema{parentUID: parent}),
		})
		if err != nil {
			t.Fatal(err)
		}
		if count := countResolvedDescriptors(resolved.Fields); count != 256 {
			t.Fatalf("expected 256 descriptors, got %d", count)
		}
	})

	t.Run("rejects 257", func(t *testing.T) {
		parent := RegisteredSchema{
			UID:              parentUID,
			Definition:       resolutionSchema("Parent 256", "", "", resolutionArrayFields("parent", 128)),
			Publisher:        resolutionPublisherA,
			NetworkID:        1,
			LedgerIndex:      1,
			TransactionIndex: 0,
		}
		child := resolutionSchema("Child 1", parentUID, "", map[string]FieldDescriptor{
			"child": {Type: "string"},
		})
		_, err := ResolveSchema(child, SchemaResolutionContext{
			NetworkID:        1,
			Publisher:        resolutionPublisherA,
			LedgerIndex:      2,
			TransactionIndex: 0,
			GetSchema:        resolutionLookup(map[string]RegisteredSchema{parentUID: parent}),
		})
		requireResolutionErrorCode(t, err, "SCHEMA_FIELD_LIMIT_EXCEEDED")
	})
}

func TestResolveSchemaValidatesSupersedesWithoutMergingIt(t *testing.T) {
	previousUID := resolutionUID(300)
	previous := RegisteredSchema{
		UID:              previousUID,
		Definition:       resolutionSchema("Previous", "", "", map[string]FieldDescriptor{"old": {Type: "string"}}),
		Publisher:        resolutionPublisherA,
		NetworkID:        1,
		LedgerIndex:      1,
		TransactionIndex: 0,
	}
	target := resolutionSchema("Replacement", "", previousUID, map[string]FieldDescriptor{
		"current": {Type: "bool"},
	})
	baseContext := SchemaResolutionContext{
		NetworkID:        1,
		Publisher:        resolutionPublisherA,
		LedgerIndex:      2,
		TransactionIndex: 0,
	}

	validContext := baseContext
	validContext.GetSchema = resolutionLookup(map[string]RegisteredSchema{previousUID: previous})
	resolved, err := ResolveSchema(target, validContext)
	if err != nil {
		t.Fatal(err)
	}
	if len(resolved.Lineage) != 0 || len(resolved.Fields) != 1 || resolved.Fields["current"].Type != "bool" {
		t.Fatalf("supersedes affected resolution: %#v", resolved)
	}
	if _, inherited := resolved.Fields["old"]; inherited {
		t.Fatal("superseded fields must not be inherited")
	}

	tests := []struct {
		name     string
		previous *RegisteredSchema
		code     string
	}{
		{name: "missing", code: "SCHEMA_SUPERSEDES_NOT_FOUND"},
		{
			name: "network mismatch",
			previous: func() *RegisteredSchema {
				value := previous
				value.NetworkID = 2
				return &value
			}(),
			code: "SCHEMA_SUPERSEDES_NOT_FOUND",
		},
		{
			name: "not prior",
			previous: func() *RegisteredSchema {
				value := previous
				value.LedgerIndex = baseContext.LedgerIndex
				value.TransactionIndex = baseContext.TransactionIndex
				return &value
			}(),
			code: "SCHEMA_SUPERSEDES_NOT_PRIOR",
		},
		{
			name: "publisher mismatch",
			previous: func() *RegisteredSchema {
				value := previous
				value.Publisher = resolutionPublisherB
				return &value
			}(),
			code: "SCHEMA_SUPERSEDES_PUBLISHER_MISMATCH",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			catalog := make(map[string]RegisteredSchema)
			if test.previous != nil {
				catalog[previousUID] = *test.previous
			}
			context := baseContext
			context.GetSchema = resolutionLookup(catalog)
			_, err := ResolveSchema(target, context)
			requireResolutionErrorCode(t, err, test.code)
		})
	}
}
