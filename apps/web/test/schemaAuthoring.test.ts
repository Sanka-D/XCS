import { describe, expect, it } from 'vitest'

import {
  createCourseCompletionDraft,
  createDiplomaDraft,
  guidedSchemaToDefinition,
  guidedSchemaToJson,
  schemaDefinitionToGuidedDraft,
} from '../app/utils/schemaAuthoring'

describe('guided schema authoring', () => {
  it('creates a valid course-completion schema without serializing optional false', () => {
    const definition = guidedSchemaToDefinition(createCourseCompletionDraft())

    expect(definition).toMatchObject({
      xcsVersion: '0.1',
      name: 'Course Completion',
      fields: {
        courseId: { type: 'string' },
        achievement: { type: 'string', optional: true },
      },
    })
    expect(guidedSchemaToJson(createCourseCompletionDraft())).not.toContain('"optional": false')
  })

  it('offers a separate diploma template', () => {
    const definition = guidedSchemaToDefinition(createDiplomaDraft())
    expect(definition.name).toBe('Diploma Award')
    expect(definition.fields).toHaveProperty('diplomaId')
  })

  it('round-trips scalar schemas through the guided editor', () => {
    const definition = guidedSchemaToDefinition(createCourseCompletionDraft())
    expect(guidedSchemaToDefinition(schemaDefinitionToGuidedDraft(definition))).toEqual(definition)
  })

  it('rejects duplicate names before JSON object construction can hide them', () => {
    const draft = createCourseCompletionDraft()
    draft.fields[1]!.name = draft.fields[0]!.name
    expect(() => guidedSchemaToDefinition(draft)).toThrow('SCHEMA_FIELD_DUPLICATE')
  })

  it('preserves legal prototype-like field names as own properties', () => {
    const draft = createCourseCompletionDraft()
    draft.fields = [{ name: '__proto__', type: 'string', optional: false }]
    const definition = guidedSchemaToDefinition(draft)
    expect(Object.hasOwn(definition.fields, '__proto__')).toBe(true)
    expect(Object.getPrototypeOf(definition.fields)).toBeNull()
  })

  it('keeps inheritance and nested descriptors in advanced JSON mode', () => {
    expect(() =>
      schemaDefinitionToGuidedDraft({
        xcsVersion: '0.1',
        name: 'Nested',
        description: 'Uses a nested descriptor.',
        fields: { result: { type: 'object', fields: { passed: { type: 'bool' } } } },
      }),
    ).toThrow('GUIDED_EDITOR_ADVANCED_SCHEMA')

    expect(() =>
      schemaDefinitionToGuidedDraft({
        xcsVersion: '0.1',
        name: 'Inherited',
        description: 'Extends an earlier schema.',
        extends: 'ab'.repeat(32),
        fields: { completedAt: { type: 'string' } },
      }),
    ).toThrow('GUIDED_EDITOR_ADVANCED_SCHEMA')
  })
})
