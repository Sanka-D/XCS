import type { ApiRoute } from './http-transport.js'
import { xcsFieldDescriptorSchema } from './http-schemas.js'

interface OpenApiOperation {
  parameters: Record<string, unknown>[]
  requestBody?: { required: boolean; content: Record<string, unknown> }
  responses: Record<string, { description: string; content?: Record<string, unknown> }>
}

/** Convert the API's JSON schemas to the OpenAPI 3.0 subset (not JSON Schema 2020-12). */
function openApiSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(openApiSchema)
  if (typeof value !== 'object' || value === null) return value
  // OAS 3.0 has neither a null type nor const. This branch accepts only null,
  // so an anyOf union retains its original meaning instead of accepting strings.
  if ('type' in value && value.type === 'null') {
    return { type: 'string', nullable: true, enum: [null] }
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== '$id')
      .map(([key, item]) => [
        key === 'const' ? 'enum' : key,
        key === 'const'
          ? [item]
          : key === '$ref' && item === 'XcsFieldDescriptor#'
            ? '#/components/schemas/XcsFieldDescriptor'
            : openApiSchema(item),
      ]),
  )
}

export function createOpenApiDocument(routes: ApiRoute[]) {
  const paths: Record<string, Partial<Record<'get' | 'post', OpenApiOperation>>> = {}
  for (const route of routes) {
    if (route.options.schema?.hide) continue
    const schema = route.options.schema
    const parameters: Record<string, unknown>[] = []
    for (const [location, parameterSchema] of [
      ['path', schema?.params],
      ['query', schema?.querystring],
    ] as const) {
      const properties = parameterSchema?.properties as Record<string, unknown> | undefined
      const required = parameterSchema?.required as string[] | undefined
      for (const [name, property] of Object.entries(properties ?? {})) {
        parameters.push({
          name,
          in: location,
          required: location === 'path' || required?.includes(name) === true,
          schema: openApiSchema(property),
        })
      }
    }
    const operation: OpenApiOperation = {
      parameters,
      responses: Object.fromEntries(
        Object.entries(schema?.response ?? { 200: {} }).map(([status, response]) => [
          status,
          {
            description: status.startsWith('2') ? 'Successful response' : 'Error response',
            content: { 'application/json': { schema: openApiSchema(response) } },
          },
        ]),
      ),
    }
    if (schema?.body !== undefined) {
      operation.requestBody = {
        required: true,
        content: { 'application/json': { schema: openApiSchema(schema.body) } },
      }
    }
    const path = route.path.replace(/:([^/]+)/gu, '{$1}')
    paths[path] ??= {}
    paths[path][route.method] = operation
  }
  return {
    openapi: '3.0.3',
    info: { title: 'XCS reference read API', version: '0.1.0-alpha.1' },
    paths,
    components: { schemas: { XcsFieldDescriptor: openApiSchema(xcsFieldDescriptorSchema) } },
  }
}

export function renderApiDocumentation(routes: ApiRoute[]): string {
  const items = routes
    .filter((route) => !route.options.schema?.hide)
    .map((route) => `<li><code>${route.method.toUpperCase()} ${route.path}</code></li>`)
    .join('\n')
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>XCS API documentation</title><body><main><h1>XCS API</h1><p><a href="/documentation/json">Download the OpenAPI 3 contract</a> for request parameters, response schemas and generated clients.</p><ul>${items}</ul></main></body></html>`
}
