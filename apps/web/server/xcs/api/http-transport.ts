import Ajv, { type AnySchema, type ValidateFunction } from 'ajv'
import fastJsonStringify, { type Schema } from 'fast-json-stringify'
import {
  createRouter,
  defineEventHandler,
  getHeader,
  getQuery,
  getResponseStatus,
  getRouterParams,
  handleCors,
  setResponseHeader,
  setResponseHeaders,
  setResponseStatus,
  type EventHandler,
  type H3Event,
} from 'h3'
import { RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible'

import { resolveClientAddress } from '../../utils/clientAddress.js'
import { HostedPayloadError } from './hosted-payloads.js'
import { IndexerUnavailableError } from './ledger-freshness.js'
import { PinningError } from './pinning.js'
import { SchemaProjectionInvalidError } from './schema-projection.js'
import { VerificationNetworkNotFoundError } from './verification.js'
import { xcsFieldDescriptorSchema } from './http-schemas.js'
import { createOpenApiDocument, renderApiDocumentation } from './openapi.js'

type JsonSchema = Record<string, unknown>
export interface RouteSchema {
  hide?: boolean
  params?: JsonSchema
  querystring?: JsonSchema
  body?: JsonSchema
  response?: Record<number, JsonSchema>
}

interface RouteOptions {
  schema?: RouteSchema
  bodyLimit?: number
  rateLimit?: number | false
  responseHeaders?: Record<string, string>
}

interface RouteInput {
  Params?: object
  Querystring?: object
  Body?: object
}

type ValidatedInput<T extends RouteInput> = {
  params: T extends { Params: infer P } ? P : Record<string, string>
  query: T extends { Querystring: infer Q } ? Q : Record<string, unknown>
  body: T extends { Body: infer B } ? B : unknown
  ip: string
}

export interface ApiRoute {
  method: 'get' | 'post'
  path: string
  options: RouteOptions
  handler: EventHandler
}

const ajv = new Ajv({
  removeAdditional: false,
  coerceTypes: false,
  allErrors: false,
  strict: false,
})
ajv.addSchema(xcsFieldDescriptorSchema)
const DEFAULT_BODY_LIMIT_BYTES = 1024 * 1024

class RequestError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly validation = false,
  ) {
    super(message)
  }
}

// Bound bytes while reading, not only Content-Length: chunked bodies are equally untrusted.
export async function readJsonBody(event: H3Event, maxBytes: number): Promise<unknown> {
  const contentType = getHeader(event, 'content-type')?.split(';')[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') {
    throw new RequestError(415, 'Unsupported Media Type')
  }
  const declaredLength = Number(getHeader(event, 'content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new RequestError(413, 'Request body is too large')
  }
  // Nitro localFetch supplies req.body directly; the Web adapter supplies a Web stream.
  // Neither emits Node request stream events, unlike an external HTTP request.
  const requestWithBody = event.node.req as typeof event.node.req & {
    body?: unknown
    rawBody?: unknown
    [key: symbol]: unknown
  }
  const suppliedBody: unknown = await (event._requestBody ??
    event.web?.request?.body ??
    requestWithBody[Symbol.for('h3RawBody')] ??
    requestWithBody.rawBody ??
    requestWithBody.body)
  const bytes =
    suppliedBody !== undefined && suppliedBody !== null
      ? await readSuppliedBody(suppliedBody, maxBytes)
      : await new Promise<Buffer>((resolve, reject) => {
          const request = event.node.req
          if (request.readableEnded) {
            reject(new RequestError(400, 'Invalid JSON body'))
            return
          }
          const chunks: Buffer[] = []
          let size = 0
          const cleanup = () => {
            request.off('data', onData)
            request.off('end', onEnd)
            request.off('error', onError)
            request.off('aborted', onAborted)
          }
          const onError = (error: Error) => {
            cleanup()
            reject(error)
          }
          const onAborted = () => onError(new RequestError(400, 'Request body was interrupted'))
          const onEnd = () => {
            cleanup()
            resolve(Buffer.concat(chunks, size))
          }
          const onData = (chunk: Buffer | string) => {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
            size += buffer.length
            if (size > maxBytes) {
              cleanup()
              // Drain without retaining bytes; destroying the socket would hide the 413 response.
              request.resume()
              reject(new RequestError(413, 'Request body is too large'))
              return
            }
            chunks.push(buffer)
          }
          request.on('data', onData)
          request.once('end', onEnd)
          request.once('error', onError)
          request.once('aborted', onAborted)
        })
  try {
    return JSON.parse(bytes.toString('utf8')) as unknown
  } catch {
    throw new RequestError(400, 'Invalid JSON body')
  }
}

async function readSuppliedBody(body: unknown, maxBytes: number): Promise<Buffer> {
  if (body instanceof ReadableStream) {
    const reader = body.getReader()
    const chunks: Buffer[] = []
    let size = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = Buffer.from(value)
        size += chunk.length
        if (size > maxBytes) {
          await reader.cancel()
          throw new RequestError(413, 'Request body is too large')
        }
        chunks.push(chunk)
      }
      return Buffer.concat(chunks, size)
    } finally {
      reader.releaseLock()
    }
  }
  const bytes =
    typeof body === 'string' || body instanceof Uint8Array
      ? Buffer.from(body)
      : Buffer.from(JSON.stringify(body))
  if (bytes.length > maxBytes) throw new RequestError(413, 'Request body is too large')
  return bytes
}

function validate(validateValue: ValidateFunction | undefined, value: unknown, field: string) {
  if (validateValue !== undefined && !validateValue(value)) {
    throw new RequestError(400, `${field} ${ajv.errorsText(validateValue.errors)}`, true)
  }
}

/** JSON schemas are the single validation, public-serialization and OpenAPI contract. */
export function defineApiRoute<T extends RouteInput = RouteInput>(
  method: ApiRoute['method'],
  path: string,
  options: RouteOptions,
  handler: (event: H3Event, input: ValidatedInput<T>) => unknown | Promise<unknown>,
): ApiRoute {
  const compile = (schema: JsonSchema | undefined) =>
    schema === undefined ? undefined : ajv.compile(schema as AnySchema)
  const paramsValidator = compile(options.schema?.params)
  const queryValidator = compile(options.schema?.querystring)
  const bodyValidator = compile(options.schema?.body)
  const serializers = new Map(
    Object.entries(options.schema?.response ?? {}).map(([status, schema]) => [
      Number(status),
      fastJsonStringify(schema as unknown as Schema, {
        schema: { XcsFieldDescriptor: xcsFieldDescriptorSchema as unknown as Schema },
      }),
    ]),
  )
  return {
    method,
    path,
    options,
    handler: defineEventHandler(async (event) => {
      const params = getRouterParams(event, { decode: true })
      const query = getQuery(event)
      const body =
        method === 'post'
          ? await readJsonBody(event, options.bodyLimit ?? DEFAULT_BODY_LIMIT_BYTES)
          : undefined
      validate(paramsValidator, params, 'params')
      validate(queryValidator, query, 'querystring')
      validate(bodyValidator, body, 'body')
      const result = await handler(event, {
        params,
        query,
        body,
        ip: event.context.xcsClientAddress as string,
      } as ValidatedInput<T>)
      if (typeof result === 'string' || result instanceof Uint8Array) return result
      setResponseHeader(event, 'content-type', 'application/json; charset=utf-8')
      const serialize = serializers.get(getResponseStatus(event))
      return serialize === undefined ? JSON.stringify(result) : serialize(result)
    }),
  }
}

function errorResponse(event: H3Event, error: unknown) {
  if (error instanceof HostedPayloadError || error instanceof PinningError) {
    setResponseStatus(event, error.statusCode)
    return { error: error.code, message: error.code }
  }
  if (
    error instanceof SchemaProjectionInvalidError ||
    error instanceof IndexerUnavailableError ||
    error instanceof VerificationNetworkNotFoundError
  ) {
    setResponseStatus(event, error.statusCode)
    return { error: error.code, message: error.message }
  }
  const statusCode = error instanceof RequestError ? error.statusCode : 500
  setResponseStatus(event, statusCode)
  return {
    error:
      error instanceof RequestError && error.validation
        ? 'VALIDATION_ERROR'
        : statusCode >= 500
          ? 'INTERNAL_ERROR'
          : 'REQUEST_ERROR',
    message: statusCode >= 500 ? 'Internal server error' : (error as Error).message,
  }
}

function headResponse(event: H3Event, response: unknown) {
  if (event.method !== 'HEAD') return response
  const bytes =
    typeof response === 'string' || response instanceof Uint8Array
      ? response
      : JSON.stringify(response)
  if (bytes !== undefined) setResponseHeader(event, 'content-length', Buffer.byteLength(bytes))
  return ''
}

export function createApiTransport(
  routes: ApiRoute[],
  options: {
    allowedOrigins?: string[]
    trustedProxyCidrs?: string[]
    globalRateLimit?: number
    onRateLimited?: (path: string) => void
  },
) {
  const router = createRouter()
  const globalLimiter = new RateLimiterMemory({
    points: options.globalRateLimit ?? 100,
    duration: 60,
  })
  for (const route of routes) {
    const limiter =
      typeof route.options.rateLimit === 'number'
        ? new RateLimiterMemory({ points: route.options.rateLimit, duration: 60 })
        : globalLimiter
    const handler = defineEventHandler(async (event) => {
      setResponseHeaders(event, route.options.responseHeaders ?? {})
      try {
        if (route.options.rateLimit !== false) {
          try {
            await limiter.consume(event.context.xcsClientAddress as string)
          } catch (error) {
            if (!(error instanceof RateLimiterRes)) throw error
            options.onRateLimited?.(route.path)
            setResponseStatus(event, 429)
            const retryAfter = Math.max(1, Math.ceil(error.msBeforeNext / 1000))
            setResponseHeader(event, 'retry-after', retryAfter)
            return {
              statusCode: 429,
              error: 'Too Many Requests',
              message: `Rate limit exceeded, retry in ${retryAfter} seconds`,
            }
          }
        }
        return await route.handler(event)
      } catch (error) {
        return errorResponse(event, error)
      }
    })
    router[route.method](route.path, handler)
    if (route.method === 'get') router.head(route.path, handler)
  }
  const openapi = createOpenApiDocument(routes)
  router.get(
    '/documentation/json',
    defineEventHandler(() => openapi),
  )
  router.get(
    '/documentation',
    defineEventHandler(() => renderApiDocumentation(routes)),
  )
  router.get(
    '/documentation/',
    defineEventHandler(() => renderApiDocumentation(routes)),
  )
  return {
    openapi,
    handler: defineEventHandler(async (event) => {
      if (typeof event.context.xcsClientAddress !== 'string') {
        event.context.xcsClientAddress = resolveClientAddress(
          event.node.req.socket.remoteAddress,
          getHeader(event, 'x-forwarded-for'),
          (options.trustedProxyCidrs ?? []).join(','),
        )
      }
      if (
        handleCors(event, {
          origin: options.allowedOrigins ?? ['http://localhost:3000'],
          methods: ['GET', 'POST'],
          credentials: false,
        })
      )
        return
      try {
        return headResponse(event, await router.handler(event))
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'statusCode' in error &&
          error.statusCode === 404
        ) {
          setResponseStatus(event, 404)
          return headResponse(event, { error: 'NOT_FOUND', message: 'Route not found' })
        }
        if (
          typeof error === 'object' &&
          error !== null &&
          'statusCode' in error &&
          error.statusCode === 405
        ) {
          return headResponse(
            event,
            errorResponse(event, new RequestError(405, 'Method not allowed')),
          )
        }
        return headResponse(event, errorResponse(event, error))
      }
    }),
  }
}
