import { fail } from './errors.js'

function assertPairedSurrogates(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = value.charCodeAt(index + 1)
      if (index + 1 >= value.length || low < 0xdc00 || low > 0xdfff) {
        fail('UTF8_INVALID', 'String contains an unpaired high surrogate', '$', { offset: index })
      }
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      fail('UTF8_INVALID', 'String contains an unpaired low surrogate', '$', { offset: index })
    }
  }
}

export function encodeUtf8(value: string): Uint8Array {
  if (typeof value !== 'string') return fail('UTF8_INVALID', 'UTF-8 input must be a string')
  assertPairedSurrogates(value)
  return new TextEncoder().encode(value)
}

export function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (cause) {
    return fail('UTF8_INVALID', 'Bytes are not valid UTF-8', '$', { cause: String(cause) })
  }
}

export function bytesToHex(bytes: Uint8Array, uppercase = false): string {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return uppercase ? hex.toUpperCase() : hex
}

export function hexToBytes(hex: string): Uint8Array {
  if (typeof hex !== 'string' || hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
    return fail('HEX_INVALID', 'Hexadecimal input must contain complete byte pairs', '$', {
      value: hex,
    })
  }
  const result = new Uint8Array(hex.length / 2)
  for (let index = 0; index < result.length; index += 1) {
    result[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  }
  return result
}

/** XRPL JSON convention: UTF-8 bytes represented as uppercase hexadecimal. */
export function encodeUtf8Hex(value: string): string {
  return bytesToHex(encodeUtf8(value), true)
}

export function decodeUtf8Hex(hex: string): string {
  return decodeUtf8(hexToBytes(hex))
}
