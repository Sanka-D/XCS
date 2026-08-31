package xcs

// RegisteredSchema contains the ledger coordinates and normalized definition
// required to resolve schema relationships. Its UID is assumed to have already
// been verified when the registration was accepted into the caller's catalog.
type RegisteredSchema struct {
	UID              string           `json:"uid"`
	Definition       SchemaDefinition `json:"definition"`
	Publisher        string           `json:"publisher"`
	NetworkID        uint32           `json:"networkId"`
	LedgerIndex      uint32           `json:"ledgerIndex"`
	TransactionIndex uint32           `json:"transactionIndex"`
}

// SchemaResolutionContext identifies the schema being resolved and supplies
// the previously validated schema catalog for its network.
type SchemaResolutionContext struct {
	NetworkID        uint32
	Publisher        string
	LedgerIndex      uint32
	TransactionIndex uint32
	GetSchema        func(uid string) (RegisteredSchema, bool)
}

// ResolvedSchema contains the child definition, its complete inherited field
// map and parent UIDs ordered from the root to the direct parent.
type ResolvedSchema struct {
	Definition SchemaDefinition           `json:"definition"`
	Fields     map[string]FieldDescriptor `json:"fields"`
	Lineage    []string                   `json:"lineage"`
}

func registeredSchemaIsPrior(candidate RegisteredSchema, ledgerIndex uint32, transactionIndex uint32) bool {
	return candidate.LedgerIndex < ledgerIndex ||
		(candidate.LedgerIndex == ledgerIndex && candidate.TransactionIndex < transactionIndex)
}

func cloneFieldDescriptor(descriptor FieldDescriptor) FieldDescriptor {
	cloned := FieldDescriptor{
		Type:      descriptor.Type,
		Optional:  descriptor.Optional,
		itemsSet:  descriptor.itemsSet,
		fieldsSet: descriptor.fieldsSet,
	}
	if descriptor.Items != nil {
		items := cloneFieldDescriptor(*descriptor.Items)
		cloned.Items = &items
	}
	if descriptor.Fields != nil {
		cloned.Fields = cloneSchemaFields(descriptor.Fields)
	}
	return cloned
}

func cloneSchemaFields(fields map[string]FieldDescriptor) map[string]FieldDescriptor {
	cloned := make(map[string]FieldDescriptor, len(fields))
	for name, descriptor := range fields {
		cloned[name] = cloneFieldDescriptor(descriptor)
	}
	return cloned
}

func cloneSchemaDefinition(schema SchemaDefinition) SchemaDefinition {
	return SchemaDefinition{
		XCSVersion:  schema.XCSVersion,
		Name:        schema.Name,
		Description: schema.Description,
		Extends:     schema.Extends,
		Supersedes:  schema.Supersedes,
		Fields:      cloneSchemaFields(schema.Fields),
	}
}

func countResolvedDescriptors(fields map[string]FieldDescriptor) int {
	count := 0
	for _, descriptor := range fields {
		count += countResolvedDescriptor(descriptor)
	}
	return count
}

func countResolvedDescriptor(descriptor FieldDescriptor) int {
	switch descriptor.Type {
	case "array":
		if descriptor.Items == nil {
			return 1
		}
		return 1 + countResolvedDescriptor(*descriptor.Items)
	case "object":
		return 1 + countResolvedDescriptors(descriptor.Fields)
	default:
		return 1
	}
}

func resolveSchemaInternal(
	schema SchemaDefinition,
	context SchemaResolutionContext,
	visiting map[string]bool,
) (ResolvedSchema, error) {
	lineage := make([]string, 0)
	fields := make(map[string]FieldDescriptor)

	if schema.Extends != "" {
		if len(visiting) >= maxSchemaDepth-1 {
			return ResolvedSchema{}, invalid(
				"SCHEMA_DEPTH_EXCEEDED",
				"$.extends",
				"inheritance depth exceeds %d",
				maxSchemaDepth,
			)
		}
		if visiting[schema.Extends] {
			return ResolvedSchema{}, invalid(
				"SCHEMA_INHERITANCE_CYCLE",
				"$.extends",
				"schema inheritance cycle detected",
			)
		}

		parent, found := context.GetSchema(schema.Extends)
		if !found || parent.UID != schema.Extends {
			return ResolvedSchema{}, invalid(
				"SCHEMA_PARENT_NOT_FOUND",
				"$.extends",
				"parent schema %s was not found",
				schema.Extends,
			)
		}
		if parent.NetworkID != context.NetworkID {
			return ResolvedSchema{}, invalid(
				"SCHEMA_PARENT_NETWORK_MISMATCH",
				"$.extends",
				"parent schema belongs to a different XRPL network",
			)
		}
		if !registeredSchemaIsPrior(parent, context.LedgerIndex, context.TransactionIndex) {
			return ResolvedSchema{}, invalid(
				"SCHEMA_PARENT_NOT_PRIOR",
				"$.extends",
				"parent schema must precede its child",
			)
		}
		if err := ValidateSchema(parent.Definition); err != nil {
			return ResolvedSchema{}, err
		}

		visiting[schema.Extends] = true
		resolvedParent, err := resolveSchemaInternal(
			cloneSchemaDefinition(parent.Definition),
			SchemaResolutionContext{
				NetworkID:        parent.NetworkID,
				Publisher:        parent.Publisher,
				LedgerIndex:      parent.LedgerIndex,
				TransactionIndex: parent.TransactionIndex,
				GetSchema:        context.GetSchema,
			},
			visiting,
		)
		delete(visiting, schema.Extends)
		if err != nil {
			return ResolvedSchema{}, err
		}

		lineage = append(lineage, resolvedParent.Lineage...)
		lineage = append(lineage, schema.Extends)
		if len(lineage)+1 > maxSchemaDepth {
			return ResolvedSchema{}, invalid(
				"SCHEMA_DEPTH_EXCEEDED",
				"$.extends",
				"inheritance depth exceeds %d",
				maxSchemaDepth,
			)
		}
		fields = cloneSchemaFields(resolvedParent.Fields)
	}

	for name, descriptor := range schema.Fields {
		if _, inherited := fields[name]; inherited {
			return ResolvedSchema{}, invalid(
				"SCHEMA_OVERRIDE_FORBIDDEN",
				"$.fields."+name,
				"inherited field %s cannot be redefined",
				name,
			)
		}
		fields[name] = cloneFieldDescriptor(descriptor)
	}

	if schema.Supersedes != "" {
		previous, found := context.GetSchema(schema.Supersedes)
		if !found || previous.UID != schema.Supersedes || previous.NetworkID != context.NetworkID {
			return ResolvedSchema{}, invalid(
				"SCHEMA_SUPERSEDES_NOT_FOUND",
				"$.supersedes",
				"superseded schema was not found on this network",
			)
		}
		if !registeredSchemaIsPrior(previous, context.LedgerIndex, context.TransactionIndex) {
			return ResolvedSchema{}, invalid(
				"SCHEMA_SUPERSEDES_NOT_PRIOR",
				"$.supersedes",
				"superseded schema must precede its replacement",
			)
		}
		if previous.Publisher != context.Publisher {
			return ResolvedSchema{}, invalid(
				"SCHEMA_SUPERSEDES_PUBLISHER_MISMATCH",
				"$.supersedes",
				"only the original publisher may supersede a schema",
			)
		}
	}

	if countResolvedDescriptors(fields) > maxSchemaFields {
		return ResolvedSchema{}, invalid(
			"SCHEMA_FIELD_LIMIT_EXCEEDED",
			"$.fields",
			"resolved schema contains more than %d fields",
			maxSchemaFields,
		)
	}

	return ResolvedSchema{
		Definition: cloneSchemaDefinition(schema),
		Fields:     fields,
		Lineage:    lineage,
	}, nil
}

// ResolveSchema validates and resolves a schema against previously registered
// schemas. GetSchema must return only registrations accepted on the same frozen
// protocol profile; this function still checks UID, network and ledger ordering.
func ResolveSchema(input SchemaDefinition, context SchemaResolutionContext) (ResolvedSchema, error) {
	if context.GetSchema == nil {
		return ResolvedSchema{}, invalid(
			"SCHEMA_INVALID",
			"$context",
			"schema resolution context requires GetSchema",
		)
	}
	if err := ValidateSchema(input); err != nil {
		return ResolvedSchema{}, err
	}
	return resolveSchemaInternal(cloneSchemaDefinition(input), context, make(map[string]bool))
}
