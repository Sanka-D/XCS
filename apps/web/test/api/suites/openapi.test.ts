import { describe, expect, it } from 'vitest'
import { createOpenApiDocument } from '../../../server/xcs/api/openapi'
import { defineApiRoute } from '../../../server/xcs/api/http-transport'

describe('OpenAPI 3.0 schemas', () => {
  it('converts const and null branches without widening null to arbitrary strings', () => {
    const document = createOpenApiDocument([
      defineApiRoute(
        'get',
        '/test',
        {
          schema: {
            response: {
              200: {
                type: 'object',
                properties: {
                  kind: { type: 'string', const: 'credential' },
                  optionalValue: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
                },
              },
            },
          },
        },
        () => ({}),
      ),
    ])
    const response = document.paths['/test']!.get!.responses['200']!
    expect(response.content).toEqual({
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['credential'] },
            optionalValue: {
              anyOf: [{ type: 'integer' }, { type: 'string', nullable: true, enum: [null] }],
            },
          },
        },
      },
    })
    const descriptor = JSON.stringify(document.components)
    expect(descriptor).toContain('#/components/schemas/XcsFieldDescriptor')
    expect(descriptor).not.toContain('"$id"')
    expect(descriptor).not.toContain('"const"')
  })
})
