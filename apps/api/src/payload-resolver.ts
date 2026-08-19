import { lookup } from 'node:dns/promises'

import { inspectPayloadUri } from '@xcs-protocol/core'
import { Agent, fetch } from 'undici'

import { assertSafeHttpsPayloadUrl, isPublicAddress } from './internal/network-safety.js'
import type { PayloadResolver } from './types.js'

const MAX_PAYLOAD_BYTES = 1024 * 1024
const MAX_REDIRECTS = 2
const FETCH_TIMEOUT_MS = 5_000

export class PayloadUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'PayloadUnavailableError'
  }
}

export class DisabledPayloadResolver implements PayloadResolver {
  async resolve(_uri: string): Promise<Uint8Array> {
    throw new PayloadUnavailableError('Server-side payload fetching is disabled')
  }
}

async function resolvePublicAddress(hostname: string) {
  const addresses = await lookup(hostname, { all: true, verbatim: true })
  if (addresses.length === 0 || addresses.some((entry) => !isPublicAddress(entry.address))) {
    throw new PayloadUnavailableError('Payload hostname resolves to a non-public address')
  }
  return addresses[0]!
}

function isJsonContentType(value: string | null): boolean {
  if (value === null) return false
  const mediaType = value.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  return mediaType === 'application/json' || mediaType.endsWith('+json')
}

async function readLimited(response: Awaited<ReturnType<typeof fetch>>): Promise<Uint8Array> {
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > MAX_PAYLOAD_BYTES) {
    throw new PayloadUnavailableError('Payload exceeds the 1 MiB limit')
  }
  if (response.body === null) return new Uint8Array()

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_PAYLOAD_BYTES) {
      await reader.cancel()
      throw new PayloadUnavailableError('Payload exceeds the 1 MiB limit')
    }
    chunks.push(value)
  }

  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

async function fetchPinned(initialUrl: URL, requireJsonContentType: boolean): Promise<Uint8Array> {
  let currentUrl = initialUrl

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    try {
      assertSafeHttpsPayloadUrl(currentUrl)
    } catch (error) {
      throw new PayloadUnavailableError('Payload URL must use HTTPS without credentials', {
        cause: error,
      })
    }
    const resolved = await resolvePublicAddress(currentUrl.hostname)
    const agent = new Agent({
      connect: {
        lookup: (_hostname, _options, callback) => {
          callback(null, resolved.address, resolved.family)
        },
      },
    })

    try {
      const response = await fetch(currentUrl, {
        dispatcher: agent,
        redirect: 'manual',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { accept: 'application/json' },
      })
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        await response.body?.cancel()
        if (location === null || redirect === MAX_REDIRECTS) {
          throw new PayloadUnavailableError('Payload redirect limit exceeded')
        }
        currentUrl = new URL(location, currentUrl)
        continue
      }
      if (!response.ok) {
        await response.body?.cancel()
        throw new PayloadUnavailableError(`Payload server returned HTTP ${response.status}`)
      }
      if (requireJsonContentType && !isJsonContentType(response.headers.get('content-type'))) {
        await response.body?.cancel()
        throw new PayloadUnavailableError('HTTPS payload is not served as JSON')
      }
      return await readLimited(response)
    } catch (error) {
      if (error instanceof PayloadUnavailableError) throw error
      throw new PayloadUnavailableError('Payload fetch failed', { cause: error })
    } finally {
      await agent.close()
    }
  }

  throw new PayloadUnavailableError('Payload redirect limit exceeded')
}

async function fetchConfiguredGateway(url: URL): Promise<Uint8Array> {
  try {
    const response = await fetch(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: 'application/octet-stream, application/json' },
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw new PayloadUnavailableError(`IPFS gateway returned HTTP ${response.status}`)
    }
    return await readLimited(response)
  } catch (error) {
    if (error instanceof PayloadUnavailableError) throw error
    throw new PayloadUnavailableError('IPFS gateway fetch failed', { cause: error })
  }
}

export class SafePayloadResolver implements PayloadResolver {
  private readonly ipfsGateway: URL

  constructor(ipfsGateway: string) {
    this.ipfsGateway = new URL(ipfsGateway.endsWith('/') ? ipfsGateway : `${ipfsGateway}/`)
    if (
      !['http:', 'https:'].includes(this.ipfsGateway.protocol) ||
      this.ipfsGateway.username !== '' ||
      this.ipfsGateway.password !== ''
    ) {
      throw new Error('IPFS gateway must be an HTTP(S) URL without credentials')
    }
  }

  async resolve(uri: string): Promise<Uint8Array> {
    const parsed = inspectPayloadUri(uri)
    if (parsed.kind === 'https') {
      return fetchPinned(new URL(parsed.fetchUrl), true)
    }
    const url = new URL(`ipfs/${parsed.cid}`, this.ipfsGateway)
    return fetchConfiguredGateway(url)
  }
}
