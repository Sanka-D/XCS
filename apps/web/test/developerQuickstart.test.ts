import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

import {
  assertDeveloperExactGeneration,
  assertDeveloperSnapshotCurrent,
  buildDeveloperQuickstartSnippets,
  normalizeDeveloperApiBaseUrl,
  normalizeDeveloperGenerationId,
  parseDeveloperLocalPayload,
} from '../app/utils/developerQuickstart'

const GENERATION_ID = '34'.repeat(32)
const PROFILE_ID = 'xrpl-testnet-xcs-v0.1'
const ISSUER = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh'
const SUBJECT = 'r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59'
const SCHEMA_UID = '12'.repeat(32)
const URI = `https://issuer.example/credential.json#xcs-sha256=${'ab'.repeat(32)}`

describe('developer quickstart', () => {
  it('normalizes only explicit runtime and exact-generation coordinates', () => {
    expect(normalizeDeveloperApiBaseUrl('https://api.example/xcs/')).toBe('https://api.example/xcs')
    expect(normalizeDeveloperApiBaseUrl('http://127.0.0.1:3001/')).toBe('http://127.0.0.1:3001')
    expect(normalizeDeveloperGenerationId(GENERATION_ID.toUpperCase())).toBe(GENERATION_ID)
    expect(() => normalizeDeveloperApiBaseUrl('https://token@example.com')).toThrow(
      'DEVELOPER_API_BASE_URL_INVALID',
    )
    expect(() => normalizeDeveloperApiBaseUrl('https://api.example?token=secret')).toThrow(
      'DEVELOPER_API_BASE_URL_INVALID',
    )
    expect(() => normalizeDeveloperApiBaseUrl('http://api.example')).toThrow(
      'DEVELOPER_API_BASE_URL_INVALID',
    )
    expect(() => normalizeDeveloperApiBaseUrl('https://api.example/\n')).toThrow(
      'DEVELOPER_API_BASE_URL_INVALID',
    )
    expect(() => normalizeDeveloperApiBaseUrl('https:\\api.example')).toThrow(
      'DEVELOPER_API_BASE_URL_INVALID',
    )
    expect(() => normalizeDeveloperGenerationId('not-a-generation')).toThrow(
      'DEVELOPER_GENERATION_ID_INVALID',
    )
  })

  it('requires one JSON object with strict parsing for the local payload', () => {
    expect(parseDeveloperLocalPayload('{"claims":{}}')).toEqual({ claims: {} })
    expect(() => parseDeveloperLocalPayload('[]')).toThrow('DEVELOPER_PAYLOAD_OBJECT_REQUIRED')
    expect(() => parseDeveloperLocalPayload('{"claims":{},"claims":{}}')).toThrow()
  })

  it('fails closed when verification points at another generation or snapshot', () => {
    expect(() => assertDeveloperExactGeneration(GENERATION_ID, GENERATION_ID)).not.toThrow()
    expect(() => assertDeveloperExactGeneration(GENERATION_ID, '56'.repeat(32))).toThrow(
      'DEVELOPER_GENERATION_REPLACED',
    )

    const expected = {
      profileId: PROFILE_ID,
      generationId: GENERATION_ID,
      issuer: ISSUER,
      subject: SUBJECT,
      schemaUid: SCHEMA_UID,
      uri: URI,
    }
    expect(() => assertDeveloperSnapshotCurrent(expected, expected)).not.toThrow()
    expect(() =>
      assertDeveloperSnapshotCurrent(expected, { ...expected, uri: `${URI}&changed=true` }),
    ).toThrow('DEVELOPER_GENERATION_CHANGED')
  })

  it('builds executable, privacy-explicit examples from the loaded profile and tuple', () => {
    const snippets = buildDeveloperQuickstartSnippets({
      apiBaseUrl: 'https://api.example/xcs',
      profileId: PROFILE_ID,
      generationId: GENERATION_ID,
      credential: {
        issuer: ISSUER,
        subject: SUBJECT,
        schemaUid: SCHEMA_UID,
        uri: URI,
        standaloneSchema: true,
      },
    })

    expect(snippets.curl).toContain(
      `/v1/networks/${PROFILE_ID}/credential-generations/${GENERATION_ID}`,
    )
    expect(snippets.curl).toContain('resolvePayload:false')
    expect(snippets.curl).toContain('payload:$payload[0]')
    expect(snippets.curl).toContain("jq '{onChain,schema,payload,issuerTrust}'")
    expect(snippets.typescript).toContain('const before = await verify({ resolvePayload: false })')
    expect(snippets.typescript).toContain('const report = await verify({ payload })')
    expect(snippets.typescript).toContain("throw new Error('GENERATION_REPLACED')")
    expect(snippets.cli).toContain('exec node dist/bin.js payload check')
    expect(snippets.cli).toContain('exec node dist/bin.js credential verify')
    expect(snippets.cli).toContain('pnpm --filter @xcs-protocol/cli... build')
    expect(snippets.cli).toContain('set -euo pipefail')
    expect(snippets.cli).toContain('schema-response.json')
    expect(snippets.cli).toContain("jq -r '.generationId'")
    expect(snippets.cli).not.toContain('pnpm add')
    expect(snippets.cli).not.toContain('pnpm dlx')
    expect(snippets.signer).toContain('type Signer')
    expect(snippets.signer).toContain('buildCredentialCreate')
    expect(snippets.signer).toContain('connectAndValidateNetwork(xrplClient, profile)')
    expect(snippets.signer).toContain("result.status !== 'validated'")
    expect(snippets.signer).toContain("result.transactionResult !== 'tesSUCCESS'")
    expect(snippets.signer).not.toMatch(/seed\s*:/u)

    const inherited = buildDeveloperQuickstartSnippets({
      apiBaseUrl: 'https://api.example/xcs',
      profileId: PROFILE_ID,
      generationId: GENERATION_ID,
      credential: {
        issuer: ISSUER,
        subject: SUBJECT,
        schemaUid: SCHEMA_UID,
        uri: URI,
        standaloneSchema: false,
      },
    })
    expect(inherited.cli).not.toContain('payload check ./credential.json')
    expect(inherited.cli).toContain('schema inherits fields')

    const metadataOnly = buildDeveloperQuickstartSnippets({
      apiBaseUrl: 'https://api.example/xcs',
      profileId: PROFILE_ID,
      generationId: GENERATION_ID,
    })
    expect(metadataOnly.cli).toBeNull()
    expect(metadataOnly.curl).toContain('metadata_report')
    expect(metadataOnly.curl).not.toContain('PAYLOAD_FILE')
    expect(metadataOnly.curl).not.toContain('payload:$payload[0]')
    expect(metadataOnly.typescript).toContain('const metadata = await verify')
    expect(metadataOnly.typescript).not.toContain('credentialHexToUri')
    expect(metadataOnly.typescript).not.toContain('readFile')

    const marker = '# Four API dimensions'
    const guard = snippets.cli!.slice(snippets.cli!.indexOf(marker))
    const replacedGeneration = '56'.repeat(32)
    const executed = spawnSync(
      'bash',
      [
        '-c',
        `set -euo pipefail
GENERATION_ID=${GENERATION_ID}
pnpm() { printf '%s\\n' '{"generationId":"${replacedGeneration}"}'; }
jq() {
  if [ "\${1-}" = '-r' ]; then printf '%s\\n' '${replacedGeneration}'; else cat; fi
}
${guard}`,
      ],
      { encoding: 'utf8' },
    )
    expect(executed.status).not.toBe(0)
    expect(executed.stdout).toBe('')
  })
})
