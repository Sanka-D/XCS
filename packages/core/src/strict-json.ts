import { fail } from './errors.js'
import type { JsonObject, JsonValue } from './types.js'

const NUMBER = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/
const HEX4 = /^[0-9a-fA-F]{4}$/

/**
 * Parse JSON without JSON.parse's silent duplicate-key replacement and while
 * enforcing the Unicode and finite-number requirements needed by I-JSON/JCS.
 */
export function parseJsonStrict(text: string): JsonValue {
  if (typeof text !== 'string') {
    return fail('JSON_INVALID', 'JSON input must be a string', '$')
  }

  let offset = 0

  const error = (message: string): never =>
    fail('JSON_INVALID', `${message} at offset ${offset}`, '$', { offset })

  const skipWhitespace = (): void => {
    while (
      text[offset] === ' ' ||
      text[offset] === '\n' ||
      text[offset] === '\r' ||
      text[offset] === '\t'
    ) {
      offset += 1
    }
  }

  const parseUnicodeEscape = (): string => {
    const escapeOffset = offset
    const hexadecimal = text.slice(offset, offset + 4)
    if (!HEX4.test(hexadecimal)) error('Invalid Unicode escape')
    offset += 4
    const first = Number.parseInt(hexadecimal, 16)

    if (first >= 0xd800 && first <= 0xdbff) {
      if (text.slice(offset, offset + 2) !== '\\u') {
        return fail(
          'JSON_INVALID_UNICODE',
          `High surrogate at offset ${escapeOffset} is not followed by a low surrogate`,
          '$',
          { offset: escapeOffset },
        )
      }
      offset += 2
      const lowHex = text.slice(offset, offset + 4)
      if (!HEX4.test(lowHex)) error('Invalid low-surrogate escape')
      offset += 4
      const second = Number.parseInt(lowHex, 16)
      if (second < 0xdc00 || second > 0xdfff) {
        return fail(
          'JSON_INVALID_UNICODE',
          `High surrogate at offset ${escapeOffset} is followed by an invalid low surrogate`,
          '$',
          { offset: escapeOffset },
        )
      }
      return String.fromCodePoint(0x10000 + ((first - 0xd800) << 10) + second - 0xdc00)
    }

    if (first >= 0xdc00 && first <= 0xdfff) {
      return fail('JSON_INVALID_UNICODE', `Unpaired low surrogate at offset ${escapeOffset}`, '$', {
        offset: escapeOffset,
      })
    }

    return String.fromCharCode(first)
  }

  const parseString = (): string => {
    if (text[offset] !== '"') error('Expected string')
    offset += 1
    let value = ''

    while (offset < text.length) {
      const character = text[offset]!
      if (character === '"') {
        offset += 1
        return value
      }
      if (character === '\\') {
        offset += 1
        const escaped = text[offset]
        if (escaped === undefined) error('Unterminated escape sequence')
        offset += 1
        switch (escaped) {
          case '"':
          case '\\':
          case '/':
            value += escaped
            break
          case 'b':
            value += '\b'
            break
          case 'f':
            value += '\f'
            break
          case 'n':
            value += '\n'
            break
          case 'r':
            value += '\r'
            break
          case 't':
            value += '\t'
            break
          case 'u':
            value += parseUnicodeEscape()
            break
          default:
            error(`Invalid escape \\${escaped}`)
        }
        continue
      }

      const code = character.charCodeAt(0)
      if (code < 0x20) error('Unescaped control character in string')
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = text.charCodeAt(offset + 1)
        if (next < 0xdc00 || next > 0xdfff) {
          return fail('JSON_INVALID_UNICODE', `Unpaired high surrogate at offset ${offset}`, '$', {
            offset,
          })
        }
        value += character + text[offset + 1]!
        offset += 2
        continue
      }
      if (code >= 0xdc00 && code <= 0xdfff) {
        return fail('JSON_INVALID_UNICODE', `Unpaired low surrogate at offset ${offset}`, '$', {
          offset,
        })
      }

      value += character
      offset += 1
    }

    return error('Unterminated string')
  }

  const parseValue = (): JsonValue => {
    skipWhitespace()
    const token = text[offset]

    if (token === '"') return parseString()
    if (token === '{') {
      offset += 1
      skipWhitespace()
      const object: JsonObject = Object.create(null) as JsonObject
      const keys = new Set<string>()
      if (text[offset] === '}') {
        offset += 1
        return object
      }
      while (true) {
        skipWhitespace()
        const keyOffset = offset
        const key = parseString()
        if (keys.has(key)) {
          return fail(
            'JSON_DUPLICATE_KEY',
            `Duplicate object key ${JSON.stringify(key)} at offset ${keyOffset}`,
            '$',
            { key, offset: keyOffset },
          )
        }
        keys.add(key)
        skipWhitespace()
        if (text[offset] !== ':') error("Expected ':' after object key")
        offset += 1
        object[key] = parseValue()
        skipWhitespace()
        if (text[offset] === '}') {
          offset += 1
          return object
        }
        if (text[offset] !== ',') error("Expected ',' or '}' in object")
        offset += 1
      }
    }
    if (token === '[') {
      offset += 1
      skipWhitespace()
      const array: JsonValue[] = []
      if (text[offset] === ']') {
        offset += 1
        return array
      }
      while (true) {
        array.push(parseValue())
        skipWhitespace()
        if (text[offset] === ']') {
          offset += 1
          return array
        }
        if (text[offset] !== ',') error("Expected ',' or ']' in array")
        offset += 1
      }
    }
    if (text.startsWith('true', offset)) {
      offset += 4
      return true
    }
    if (text.startsWith('false', offset)) {
      offset += 5
      return false
    }
    if (text.startsWith('null', offset)) {
      offset += 4
      return null
    }
    if (token === '-' || (token !== undefined && token >= '0' && token <= '9')) {
      const match = NUMBER.exec(text.slice(offset))
      if (match === null) return error('Invalid number')
      offset += match[0].length
      const number = Number(match[0])
      if (!Number.isFinite(number)) {
        return fail(
          'JSON_NON_IJSON_NUMBER',
          `Number at offset ${offset - match[0].length} is outside IEEE-754 finite range`,
          '$',
          { value: match[0] },
        )
      }
      return number
    }

    return error('Expected a JSON value')
  }

  skipWhitespace()
  if (offset === text.length) error('JSON input is empty')
  const value = parseValue()
  skipWhitespace()
  if (offset !== text.length) error('Unexpected trailing content')
  return value
}
