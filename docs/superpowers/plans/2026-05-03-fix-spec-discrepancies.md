# XCS Spec-Discrepancy Remediation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every gap identified in the 2026-05-03 audit between the XCS implementation and its spec/white-paper: W3C VC compliance, public IPFS storage, credential verification, wallet-based subject acceptance, schema inheritance, indexer-latency UX, and expiration enforcement.

**Architecture:** Layered. Pure utility modules (W3C VC, IPFS, canonical-JSON, signature verification) are added under `server/utils/` with unit tests. API endpoints compose these utilities. The Rust substream is extended for schema parent linking and re-packed. The frontend gets a polling composable used after every write, plus a wallet-signed acceptance flow.

**Tech Stack:** Nuxt 4 / Vue 3 / TypeScript / Zod / `postgres.js` / `xrpl.js` v4 / `xrpl-connect` v0.4 / Vitest (added in Phase 0) / Rust substreams 0.6 / Pinata REST API for IPFS.

**Phase index** — each phase ends in a green build and a commit; phases run in order but can be paused between:

| Phase | Name | Touches |
|---|---|---|
| 0 | Test infrastructure | `package.json`, `vitest.config.ts`, `tests/` |
| 1 | W3C VC wrapper + canonical JSON + Ed25519/secp256k1 proofs | `server/utils/w3c-vc.ts`, `server/utils/canonical-json.ts` |
| 2 | IPFS (Pinata) utility | `server/utils/ipfs.ts`, env, `nuxt.config.ts` |
| 3 | Public schema publishing | `server/api/schema/create.post.ts`, `validation.ts`, substream memo |
| 4 | Public credential publishing | `server/api/credential/issue.post.ts`, `validation.ts`, frontend |
| 5 | `/api/credential/verify` endpoint | `server/api/credential/verify.get.ts`, frontend `verify.vue` |
| 6 | Wallet-based subject acceptance | `accept.post.ts`, `accept.vue`, `useWallet.ts` |
| 7 | Indexer-latency UX | `app/composables/useIndexerWait.ts`, all post-write pages |
| 8 | Schema versioning (parent_uid) | `substreams/src/lib.rs`, `proto/`, `schema.sql`, API + UI |
| 9 | Expiration enforcement | `validation.ts`, `list.post.ts`, `index.get.ts`, list components |

---

## Phase 0 — Test Infrastructure

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `tests/sanity.test.ts`

- [ ] **Step 0.1: Install Vitest**

Run from project root:

```bash
npm install --save-dev vitest @vitest/coverage-v8
```

Expected: package.json updated; no errors.

- [ ] **Step 0.2: Add test scripts to `package.json`**

In `package.json`, add to the `"scripts"` object (alongside `build`, `dev`, etc.):

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 0.3: Create `vitest.config.ts` at project root**

```ts
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
  },
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('./app', import.meta.url)),
      '~~': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
});
```

- [ ] **Step 0.4: Create sanity test `tests/sanity.test.ts`**

```ts
import { describe, it, expect } from 'vitest';

describe('sanity', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 0.5: Run the test**

Run: `npm test`
Expected: 1 passed; exit code 0.

- [ ] **Step 0.6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts tests/sanity.test.ts
git commit -m "chore: add vitest test infrastructure"
```

---

## Phase 1 — W3C VC Wrapper, Canonical JSON, Proofs

The W3C VC document is a JSON object with `@context`, `type`, `issuer`, `issuanceDate`, `credentialSubject`, `credentialSchema`, and `proof`. The proof is a detached JWS-like signature over the canonicalised VC (with `proof.proofValue` removed). We use the issuer's XRPL key (secp256k1 or Ed25519) for signing, matching XRPL native crypto so verifiers can use the on-chain pubkey.

**Files:**
- Create: `server/utils/canonical-json.ts`
- Create: `server/utils/w3c-vc.ts`
- Test: `tests/canonical-json.test.ts`
- Test: `tests/w3c-vc.test.ts`

### Task 1A — Canonical JSON (RFC 8785 subset)

We implement deterministic JSON: keys sorted lexicographically, no whitespace, escape sequences per JSON spec. Numbers are emitted as JS prints them (sufficient for our integer-and-string-only payloads — we forbid floats in credentials).

- [ ] **Step 1A.1: Write the failing test `tests/canonical-json.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { canonicalize } from '../server/utils/canonical-json';

describe('canonicalize', () => {
  it('sorts top-level keys', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('sorts nested keys', () => {
    expect(canonicalize({ z: { b: 1, a: 2 } })).toBe('{"z":{"a":2,"b":1}}');
  });

  it('preserves array order', () => {
    expect(canonicalize({ a: [3, 1, 2] })).toBe('{"a":[3,1,2]}');
  });

  it('handles strings, numbers, booleans, null', () => {
    expect(canonicalize({ s: 'x', n: 1, b: true, z: null })).toBe(
      '{"b":true,"n":1,"s":"x","z":null}'
    );
  });

  it('rejects floats (lossy in cross-language contexts)', () => {
    expect(() => canonicalize({ a: 1.5 })).toThrow(/non-integer/);
  });

  it('escapes special characters in strings', () => {
    expect(canonicalize({ a: 'he said "hi"\n' })).toBe('{"a":"he said \\"hi\\"\\n"}');
  });
});
```

- [ ] **Step 1A.2: Run — expect failure (module not found)**

Run: `npm test -- tests/canonical-json.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 1A.3: Implement `server/utils/canonical-json.ts`**

```ts
type JSONValue =
  | string
  | number
  | boolean
  | null
  | JSONValue[]
  | { [k: string]: JSONValue };

export function canonicalize(value: JSONValue): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      throw new Error(
        `canonicalize: non-integer number ${value} not allowed in canonical JSON`
      );
    }
    return String(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']';
  }
  const keys = Object.keys(value).sort();
  return (
    '{' +
    keys
      .map((k) => JSON.stringify(k) + ':' + canonicalize(value[k]!))
      .join(',') +
    '}'
  );
}
```

- [ ] **Step 1A.4: Run — expect pass**

Run: `npm test -- tests/canonical-json.test.ts`
Expected: 6 passed.

- [ ] **Step 1A.5: Commit**

```bash
git add server/utils/canonical-json.ts tests/canonical-json.test.ts
git commit -m "feat(server): add canonical-json utility for VC signing"
```

### Task 1B — W3C VC Builder + Signer + Verifier

XRPL wallets expose `sign(message: Uint8Array): string` (hex DER signature for secp256k1, hex 64-byte signature for Ed25519). We sign the canonicalised VC bytes and store the signature as `proof.proofValue` (hex). The pubkey is included in `proof.verificationMethod`. The proof block looks like:

```json
{
  "type": "XrplKey2026",
  "created": "2026-05-03T12:00:00Z",
  "verificationMethod": "did:xrpl:rIssuer...#key-1",
  "proofPurpose": "assertionMethod",
  "publicKeyHex": "ED...",
  "proofValue": "<hex sig>"
}
```

**Why custom proof type?** No standard W3C suite is XRPL-native. `XrplKey2026` is documented in `server/utils/w3c-vc.ts`. Verifiers only need the pubkey and signature.

- [ ] **Step 1B.1: Write the failing test `tests/w3c-vc.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { Wallet } from 'xrpl';
import {
  buildVC,
  signVC,
  verifyVC,
  type VCInput,
} from '../server/utils/w3c-vc';

const issuerWallet = Wallet.fromSeed('sEdTM1uX8pu2do5XvTnutH6HsouMaM2');
// ^ deterministic Ed25519 testnet seed; never use in production.

const baseInput: VCInput = {
  issuerAddress: issuerWallet.address,
  issuerPublicKey: issuerWallet.publicKey,
  subjectAddress: 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe',
  schemaUid: '0123456789abcdef',
  schemaName: 'EmploymentCredential',
  data: { employer: 'Acme', role: 'Engineer' },
  issuanceDate: '2026-05-03T12:00:00Z',
};

describe('buildVC', () => {
  it('produces a W3C-compliant unsigned VC', () => {
    const vc = buildVC(baseInput);
    expect(vc['@context']).toContain('https://www.w3.org/2018/credentials/v1');
    expect(vc.type).toEqual(['VerifiableCredential', 'EmploymentCredential']);
    expect(vc.issuer).toBe(`did:xrpl:${baseInput.issuerAddress}`);
    expect(vc.credentialSubject.id).toBe(`did:xrpl:${baseInput.subjectAddress}`);
    expect(vc.credentialSubject.employer).toBe('Acme');
    expect(vc.credentialSchema.id).toBe('xcs:schema:0123456789abcdef');
    expect(vc.proof).toBeUndefined();
  });

  it('includes expirationDate when supplied', () => {
    const vc = buildVC({ ...baseInput, expirationDate: '2027-01-01T00:00:00Z' });
    expect(vc.expirationDate).toBe('2027-01-01T00:00:00Z');
  });
});

describe('signVC + verifyVC', () => {
  it('signs and verifies a VC roundtrip', () => {
    const vc = buildVC(baseInput);
    const signed = signVC(vc, issuerWallet);
    expect(signed.proof.proofValue).toMatch(/^[0-9A-F]+$/);
    expect(signed.proof.publicKeyHex).toBe(issuerWallet.publicKey);
    expect(verifyVC(signed)).toBe(true);
  });

  it('rejects tampered credentialSubject', () => {
    const signed = signVC(buildVC(baseInput), issuerWallet);
    signed.credentialSubject.role = 'CEO';
    expect(verifyVC(signed)).toBe(false);
  });

  it('rejects mismatched publicKey', () => {
    const signed = signVC(buildVC(baseInput), issuerWallet);
    const otherWallet = Wallet.fromSeed('sEdSKaCy2JT7JaM7v95H9SxkhP9wS2r');
    signed.proof.publicKeyHex = otherWallet.publicKey;
    expect(verifyVC(signed)).toBe(false);
  });
});
```

- [ ] **Step 1B.2: Run — expect failure**

Run: `npm test -- tests/w3c-vc.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 1B.3: Implement `server/utils/w3c-vc.ts`**

```ts
import { Wallet } from 'xrpl';
import { sign as keypairSign, verify as keypairVerify } from 'ripple-keypairs';
import { canonicalize } from './canonical-json';

export interface VCInput {
  issuerAddress: string;
  issuerPublicKey: string;
  subjectAddress: string;
  schemaUid: string;
  schemaName: string;
  data: Record<string, unknown>;
  issuanceDate?: string;
  expirationDate?: string;
}

export interface UnsignedVC {
  '@context': string[];
  type: string[];
  issuer: string;
  issuanceDate: string;
  expirationDate?: string;
  credentialSubject: { id: string } & Record<string, unknown>;
  credentialSchema: { id: string; type: string };
  proof?: never;
}

export interface VCProof {
  type: 'XrplKey2026';
  created: string;
  verificationMethod: string;
  proofPurpose: 'assertionMethod';
  publicKeyHex: string;
  proofValue: string; // hex signature of canonical(VC without proof)
}

export interface SignedVC extends Omit<UnsignedVC, 'proof'> {
  proof: VCProof;
}

const W3C_CONTEXT = 'https://www.w3.org/2018/credentials/v1';
const XCS_CONTEXT = 'https://xcs.xrpl/credentials/v1';

export function buildVC(input: VCInput): UnsignedVC {
  return {
    '@context': [W3C_CONTEXT, XCS_CONTEXT],
    type: ['VerifiableCredential', input.schemaName],
    issuer: `did:xrpl:${input.issuerAddress}`,
    issuanceDate: input.issuanceDate ?? new Date().toISOString(),
    ...(input.expirationDate ? { expirationDate: input.expirationDate } : {}),
    credentialSubject: {
      id: `did:xrpl:${input.subjectAddress}`,
      ...input.data,
    },
    credentialSchema: {
      id: `xcs:schema:${input.schemaUid}`,
      type: 'XCSSchemaValidator2026',
    },
  };
}

export function signVC(vc: UnsignedVC, wallet: Wallet): SignedVC {
  const canonical = canonicalize(vc as any);
  const messageHex = Buffer.from(canonical, 'utf8').toString('hex').toUpperCase();
  const signature = keypairSign(messageHex, wallet.privateKey);

  return {
    ...vc,
    proof: {
      type: 'XrplKey2026',
      created: new Date().toISOString(),
      verificationMethod: `did:xrpl:${wallet.address}#key-1`,
      proofPurpose: 'assertionMethod',
      publicKeyHex: wallet.publicKey,
      proofValue: signature,
    },
  };
}

export function verifyVC(signed: SignedVC): boolean {
  const { proof, ...unsigned } = signed;
  if (!proof || proof.type !== 'XrplKey2026') return false;

  const canonical = canonicalize(unsigned as any);
  const messageHex = Buffer.from(canonical, 'utf8').toString('hex').toUpperCase();

  try {
    return keypairVerify(messageHex, proof.proofValue, proof.publicKeyHex);
  } catch {
    return false;
  }
}
```

- [ ] **Step 1B.4: Verify `ripple-keypairs` is installed (it ships with `xrpl`)**

Run: `node -e "console.log(require.resolve('ripple-keypairs'))"`
Expected: a path under `node_modules`. If it fails, run `npm install ripple-keypairs` and commit the lock change.

- [ ] **Step 1B.5: Run — expect pass**

Run: `npm test -- tests/w3c-vc.test.ts`
Expected: 5 passed.

- [ ] **Step 1B.6: Commit**

```bash
git add server/utils/w3c-vc.ts tests/w3c-vc.test.ts package.json package-lock.json
git commit -m "feat(server): add W3C VC builder, signer, verifier with XRPL keys"
```

---

## Phase 2 — IPFS (Pinata) Utility

Single provider (Pinata) accessed via REST. JWT in env. We expose `pinJSON(obj)`, `fetchJSON(cid)`, `unpin(cid)`. CIDs are returned as v1 base32 (`bafy…`).

**Files:**
- Create: `server/utils/ipfs.ts`
- Modify: `nuxt.config.ts` (add `pinataJwt`, surface `ipfsGateway` already public)
- Modify: `.env.example`
- Test: `tests/ipfs.test.ts`

### Task 2A — IPFS client

- [ ] **Step 2A.1: Write the failing test `tests/ipfs.test.ts`**

We mock `globalThis.fetch` so this runs offline.

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub useRuntimeConfig (Nuxt global) before importing the SUT.
(globalThis as any).useRuntimeConfig = () => ({
  pinataJwt: 'test-jwt',
  public: { ipfsGateway: 'https://gateway.pinata.cloud' },
});

import { pinJSON, fetchJSON, unpin, gatewayUrl } from '../server/utils/ipfs';

describe('ipfs', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('pinJSON posts to Pinata and returns the CID', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ IpfsHash: 'bafyTest' }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    const cid = await pinJSON({ hello: 'world' });

    expect(cid).toBe('bafyTest');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.pinata.cloud/pinning/pinJSONToIPFS',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-jwt' }),
      })
    );
  });

  it('pinJSON throws on non-2xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 500 }))
    );
    await expect(pinJSON({ x: 1 })).rejects.toThrow(/Pinata pin failed/);
  });

  it('fetchJSON parses gateway response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    );
    const data = await fetchJSON('bafyTest');
    expect(data).toEqual({ ok: true });
  });

  it('unpin returns true on 200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
    expect(await unpin('bafyTest')).toBe(true);
  });

  it('gatewayUrl builds the public URL', () => {
    expect(gatewayUrl('bafyTest')).toBe('https://gateway.pinata.cloud/ipfs/bafyTest');
  });
});
```

- [ ] **Step 2A.2: Run — expect failure**

Run: `npm test -- tests/ipfs.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 2A.3: Implement `server/utils/ipfs.ts`**

```ts
const PINATA_PIN_URL = 'https://api.pinata.cloud/pinning/pinJSONToIPFS';
const PINATA_UNPIN_URL = 'https://api.pinata.cloud/pinning/unpin';

interface PinataPinResponse {
  IpfsHash: string;
}

export async function pinJSON(content: unknown): Promise<string> {
  const config = useRuntimeConfig();
  if (!config.pinataJwt) {
    throw new Error('PINATA_JWT not configured');
  }

  const res = await fetch(PINATA_PIN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.pinataJwt}`,
    },
    body: JSON.stringify({
      pinataContent: content,
      pinataOptions: { cidVersion: 1 },
    }),
  });

  if (!res.ok) {
    throw new Error(`Pinata pin failed: ${res.status} ${await res.text()}`);
  }

  const json = (await res.json()) as PinataPinResponse;
  return json.IpfsHash;
}

export async function fetchJSON<T = unknown>(cid: string): Promise<T> {
  const url = gatewayUrl(cid);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`IPFS fetch failed: ${res.status} for ${cid}`);
  }
  return (await res.json()) as T;
}

export async function unpin(cid: string): Promise<boolean> {
  const config = useRuntimeConfig();
  if (!config.pinataJwt) throw new Error('PINATA_JWT not configured');

  const res = await fetch(`${PINATA_UNPIN_URL}/${cid}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${config.pinataJwt}` },
  });
  return res.ok;
}

export function gatewayUrl(cid: string): string {
  const config = useRuntimeConfig();
  const gw = (config.public.ipfsGateway as string).replace(/\/$/, '');
  return `${gw}/ipfs/${cid}`;
}
```

- [ ] **Step 2A.4: Run — expect pass**

Run: `npm test -- tests/ipfs.test.ts`
Expected: 5 passed.

### Task 2B — Wire env + runtime config

- [ ] **Step 2B.1: Add to `.env.example` (after the `BASE_URL` line)**

```env

# IPFS (Pinata) — required for public schemas/credentials
PINATA_JWT=
IPFS_GATEWAY=https://gateway.pinata.cloud
```

- [ ] **Step 2B.2: Edit `nuxt.config.ts` to surface `pinataJwt`**

In `runtimeConfig`, add `pinataJwt` (server-only) just below `xrplRegistryAddress`:

```ts
    pinataJwt: process.env.PINATA_JWT || '',
```

The existing `public.ipfsGateway` line already reads `process.env.IPFS_GATEWAY`; leave it.

- [ ] **Step 2B.3: Run all tests**

Run: `npm test`
Expected: all suites green.

- [ ] **Step 2B.4: Commit**

```bash
git add server/utils/ipfs.ts tests/ipfs.test.ts .env.example nuxt.config.ts
git commit -m "feat(server): add Pinata IPFS utility with pin/fetch/unpin"
```

---

## Phase 3 — Public Schema Publishing

When a schema is registered with `isPublic: true`, the schema JSON is also pinned to IPFS. The CID is appended to the on-chain memo as a second value (`xcs:schema_register|cid:bafy…`) so the substream can persist it. UID stays computed over the *raw schema JSON* only — the CID is metadata.

**Decision:** memo encoding stays a single `xcs:schema_register` MemoType with the JSON in MemoData. We add an *optional second memo* with `MemoType=xcs:ipfs_cid` and `MemoData=<cid>`. This keeps backward compatibility — old indexers ignore the second memo, the substream learns to read it (Phase 8 also covers a related substream change; we can defer the substream piece to that phase, but record the CID in the API response immediately).

**Files:**
- Modify: `server/utils/validation.ts` (add `isPublic`)
- Modify: `server/utils/xrpl.ts` (accept optional `ipfsCid`, add second memo)
- Modify: `server/api/schema/create.post.ts`
- Modify: `app/components/schema/SchemaForm.vue` (toggle for `isPublic`)
- Modify: `app/pages/schemas/create.vue`

- [ ] **Step 3.1: Extend `createSchemaSchema` in `server/utils/validation.ts`**

Replace the `createSchemaSchema` block with:

```ts
export const createSchemaSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/)
    .default('1.0.0'),
  fields: z.array(schemaFieldSchema).min(1),
  isPublic: z.boolean().default(false),
});
```

- [ ] **Step 3.2: Extend `XRPLClient.registerSchema` to attach an optional CID memo**

In `server/utils/xrpl.ts`, update the `registerSchema` signature and Memos array. Replace the existing method body's `Memos:` array with:

```ts
      Memos: [
        {
          Memo: {
            MemoType: convertStringToHex('xcs:schema_register'),
            MemoData: convertStringToHex(schemaJson),
          },
        },
        ...(schemaDoc.ipfsCid
          ? [{
              Memo: {
                MemoType: convertStringToHex('xcs:ipfs_cid'),
                MemoData: convertStringToHex(schemaDoc.ipfsCid),
              },
            }]
          : []),
      ],
```

Then update the type. In `app/lib/types/schema.ts`, add an optional field to `SchemaDoc`:

```ts
export interface SchemaDoc {
  name: string;
  description?: string;
  version: string;
  fields: SchemaField[];
  ipfsCid?: string; // populated when isPublic = true
}
```

**Important:** the `ipfsCid` must be excluded from the JSON used for UID computation, otherwise the on-chain memo data and UID-input will diverge between `isPublic=false` and `isPublic=true` calls. The current `registerSchema` code constructs `orderedDoc` explicitly with `name, description?, version, fields` — leave that exact set, do NOT add `ipfsCid` to `orderedDoc`. The CID lives only in the second memo.

- [ ] **Step 3.3: Update `server/api/schema/create.post.ts` to pin then register**

Replace the entire file with:

```ts
import { createSchemaSchema } from '../../utils/validation';
import { useXRPL } from '../../utils/xrpl';
import { pinJSON } from '../../utils/ipfs';

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event);
    const validated = createSchemaSchema.parse(body);

    const schemaDoc = {
      name: validated.name,
      ...(validated.description ? { description: validated.description } : {}),
      version: validated.version,
      fields: validated.fields,
    };

    let ipfsCid: string | undefined;
    if (validated.isPublic) {
      ipfsCid = await pinJSON(schemaDoc);
    }

    const xrpl = useXRPL();
    const result = await xrpl.registerSchema({ ...schemaDoc, ipfsCid });

    return {
      success: true,
      data: {
        uid: result.uid,
        txHash: result.txHash,
        ledgerIndex: result.ledgerIndex,
        ipfsCid: ipfsCid ?? null,
        status: 'pending',
      },
    };
  } catch (error: any) {
    if (error.statusCode) throw error;
    console.error('Error registering schema:', error);
    throw createError({
      statusCode: 500,
      message: error.message || 'Failed to register schema',
    });
  }
});
```

- [ ] **Step 3.4: Add `isPublic` toggle to `SchemaForm.vue`**

Read the current `app/components/schema/SchemaForm.vue` to find where its model fields live, then add a `UCheckbox` (or `<input type="checkbox">` if the form is plain HTML):

```vue
<div class="flex items-center gap-2 mt-4">
  <input id="isPublic" v-model="form.isPublic" type="checkbox" class="h-4 w-4" />
  <label for="isPublic" class="text-sm">
    Publish schema on IPFS (public, anyone can fetch the schema JSON)
  </label>
</div>
```

In the form's `reactive`/`ref` initial state, add `isPublic: false`. In the submit handler / payload, include `isPublic: form.isPublic`.

- [ ] **Step 3.5: Surface `ipfsCid` on success in `app/pages/schemas/create.vue`**

After the schema is created, show the CID and gateway link when present. Find the success branch and add (adapt to the page's existing pattern):

```vue
<p v-if="result.ipfsCid">
  Pinned to IPFS:
  <a :href="`https://gateway.pinata.cloud/ipfs/${result.ipfsCid}`" target="_blank" class="underline">
    {{ result.ipfsCid }}
  </a>
</p>
```

- [ ] **Step 3.6: Manual smoke test**

This step requires real Pinata + XRPL testnet credentials in `.env`.

```bash
npm run dev
```

In another shell:

```bash
curl -s -X POST http://localhost:3000/api/schema/create \
  -H 'content-type: application/json' \
  -d '{
    "name":"SmokeTest",
    "description":"phase 3 smoke",
    "version":"1.0.0",
    "fields":[{"name":"foo","type":"string","required":true}],
    "isPublic":true
  }' | jq
```

Expected: response includes `data.uid`, `data.txHash`, and `data.ipfsCid` starting with `bafy`.

Then verify on the gateway:

```bash
curl -s "https://gateway.pinata.cloud/ipfs/<cid>" | jq
```

Expected: returns the schema JSON.

If you do not have Pinata creds, skip this manual step and rely on the unit tests; mark this task `[~]` and revisit.

- [ ] **Step 3.7: Commit**

```bash
git add server/utils/validation.ts server/utils/xrpl.ts server/api/schema/create.post.ts \
        app/lib/types/schema.ts app/components/schema/SchemaForm.vue app/pages/schemas/create.vue
git commit -m "feat(schema): publish public schemas to IPFS and emit CID memo"
```

---

## Phase 4 — Public Credential Publishing (W3C VC → IPFS)

When a credential is issued with `isPublic: true`, we (a) build + sign a W3C VC, (b) pin it to IPFS, (c) pass the gateway URL into the XRPL `URI` field of `CredentialCreate`. Verifiers fetch from URI → verify proof → resolve schema.

**Files:**
- Modify: `server/utils/validation.ts`
- Modify: `server/api/credential/issue.post.ts`
- Modify: `app/components/credential/CredentialForm.vue`

- [ ] **Step 4.1: Extend `issueCredentialSchema`**

Replace the block in `server/utils/validation.ts`:

```ts
export const issueCredentialSchema = z.object({
  credentialType: z.string().min(1),
  subject: z.string().regex(/^r[1-9A-HJ-NP-Za-km-z]{25,34}$/),
  data: z.record(z.string(), z.unknown()).default({}),
  isPublic: z.boolean().default(false),
  uri: z.string().optional(), // optional manual override; auto-set when isPublic
  expiresAt: z.string().optional(),
});
```

- [ ] **Step 4.2: Rewrite `server/api/credential/issue.post.ts`**

```ts
import { Wallet } from 'xrpl';
import { db } from '../../db';
import { issueCredentialSchema } from '../../utils/validation';
import { useXRPL } from '../../utils/xrpl';
import { pinJSON, gatewayUrl } from '../../utils/ipfs';
import { buildVC, signVC } from '../../utils/w3c-vc';
import type { SchemaDoc } from '~/lib/types/schema';

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event);
    const validated = issueCredentialSchema.parse(body);

    const [schemaRow] = await db<{ uid: string; schema_json: SchemaDoc }[]>`
      SELECT uid, schema_json FROM schemas WHERE uid = ${validated.credentialType} LIMIT 1
    `;
    if (!schemaRow) {
      throw createError({
        statusCode: 404,
        message:
          'Schema not found in registry. Wait for the indexer to process the registration tx.',
      });
    }

    const config = useRuntimeConfig();
    const issuerWallet = Wallet.fromSeed(config.issuerSeed);

    let uri = validated.uri;
    let vcCid: string | null = null;
    if (validated.isPublic) {
      const vc = buildVC({
        issuerAddress: issuerWallet.address,
        issuerPublicKey: issuerWallet.publicKey,
        subjectAddress: validated.subject,
        schemaUid: schemaRow.uid,
        schemaName: schemaRow.schema_json.name,
        data: validated.data,
        expirationDate: validated.expiresAt,
      });
      const signed = signVC(vc, issuerWallet);
      vcCid = await pinJSON(signed);
      uri = gatewayUrl(vcCid);
    }

    const xrpl = useXRPL();
    const expiresAt = validated.expiresAt
      ? new Date(validated.expiresAt)
      : undefined;

    const result = await xrpl.createCredential({
      subject: validated.subject,
      credentialType: validated.credentialType,
      uri,
      expiresAt,
    });

    return {
      success: true,
      data: {
        txHash: result.txHash,
        ledgerIndex: result.ledgerIndex,
        ipfsCid: vcCid,
        uri: uri ?? null,
        status: 'pending',
      },
    };
  } catch (error: any) {
    if (error.statusCode) throw error;
    console.error('Error issuing credential:', error);
    throw createError({
      statusCode: 500,
      message: error.message || 'Failed to issue credential',
    });
  }
});
```

- [ ] **Step 4.3: Add `data` + `isPublic` inputs to `CredentialForm.vue`**

Open `app/components/credential/CredentialForm.vue`. Where the form posts its body, ensure it sends `data: form.data` (a plain object built from the schema's fields) and `isPublic: form.isPublic`. Add a checkbox identical to Phase 3's pattern with the label:

> "Publish credential as W3C Verifiable Credential on IPFS"

- [ ] **Step 4.4: Manual smoke test**

```bash
# After Phase 3, you have a public schema with uid <UID>
curl -s -X POST http://localhost:3000/api/credential/issue \
  -H 'content-type: application/json' \
  -d '{
    "credentialType":"<UID>",
    "subject":"rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe",
    "data":{"foo":"bar"},
    "isPublic":true
  }' | jq
```

Expected: `data.ipfsCid` is non-null, `data.uri` is the gateway URL. Fetching `data.uri` returns a JSON object with `proof.proofValue`.

- [ ] **Step 4.5: Commit**

```bash
git add server/utils/validation.ts server/api/credential/issue.post.ts \
        app/components/credential/CredentialForm.vue
git commit -m "feat(credential): build and pin signed W3C VC for public credentials"
```

---

## Phase 5 — `/api/credential/verify` Endpoint + UI

Verifies a credential by `id` or `uri`. Returns:

```ts
{
  valid: boolean,
  checks: {
    onChain: boolean,    // present in sink DB and not revoked
    notExpired: boolean,
    proofValid: boolean | null,  // null if not a public/W3C credential
    schemaMatch: boolean | null, // null if no W3C VC available
  },
  reasons: string[],     // human-readable failure reasons
}
```

**Files:**
- Create: `server/api/credential/verify.get.ts`
- Test: `tests/verify.test.ts` (pure logic only — extract a `verifyCredential` helper)
- Create: `server/utils/verify-credential.ts`
- Create: `app/pages/verify.vue`

### Task 5A — Verifier helper (pure)

- [ ] **Step 5A.1: Write `tests/verify.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { Wallet } from 'xrpl';
import { buildVC, signVC } from '../server/utils/w3c-vc';
import {
  verifyCredentialPayload,
  type SinkCredential,
  type SinkSchema,
} from '../server/utils/verify-credential';

const wallet = Wallet.fromSeed('sEdTM1uX8pu2do5XvTnutH6HsouMaM2');
const subject = 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe';

const schema: SinkSchema = {
  uid: '0123456789abcdef',
  schema_json: {
    name: 'EmploymentCredential',
    version: '1.0.0',
    fields: [{ name: 'role', type: 'string', required: true }],
  },
};

const baseCred: SinkCredential = {
  id: `${wallet.address}:${subject}:${schema.uid}`,
  issuer: wallet.address,
  subject,
  credential_type: schema.uid,
  uri: '',
  expiration: 0,
  status: 'accepted',
};

const vc = signVC(
  buildVC({
    issuerAddress: wallet.address,
    issuerPublicKey: wallet.publicKey,
    subjectAddress: subject,
    schemaUid: schema.uid,
    schemaName: 'EmploymentCredential',
    data: { role: 'Engineer' },
  }),
  wallet
);

describe('verifyCredentialPayload', () => {
  it('passes for accepted, unexpired, valid-proof credential', () => {
    const r = verifyCredentialPayload(baseCred, schema, vc);
    expect(r.valid).toBe(true);
    expect(r.checks.onChain).toBe(true);
    expect(r.checks.proofValid).toBe(true);
  });

  it('fails when revoked', () => {
    const r = verifyCredentialPayload({ ...baseCred, status: 'revoked' }, schema, vc);
    expect(r.valid).toBe(false);
    expect(r.checks.onChain).toBe(false);
    expect(r.reasons).toContain('credential has been revoked');
  });

  it('fails when expired', () => {
    const past = Math.floor(Date.now() / 1000) - 946684800 - 60;
    const r = verifyCredentialPayload({ ...baseCred, expiration: past }, schema, vc);
    expect(r.valid).toBe(false);
    expect(r.checks.notExpired).toBe(false);
  });

  it('fails when proof signature does not match', () => {
    const tampered = { ...vc, credentialSubject: { ...vc.credentialSubject, role: 'CEO' } };
    const r = verifyCredentialPayload(baseCred, schema, tampered);
    expect(r.checks.proofValid).toBe(false);
    expect(r.valid).toBe(false);
  });

  it('fails when VC.credentialSchema.id does not match sink schema uid', () => {
    const wrongVc = { ...vc, credentialSchema: { ...vc.credentialSchema, id: 'xcs:schema:deadbeef' } };
    const r = verifyCredentialPayload(baseCred, schema, wrongVc);
    expect(r.checks.schemaMatch).toBe(false);
  });

  it('returns nulls for proof checks when no VC supplied (private credential)', () => {
    const r = verifyCredentialPayload(baseCred, schema, null);
    expect(r.checks.proofValid).toBeNull();
    expect(r.checks.schemaMatch).toBeNull();
    expect(r.valid).toBe(true); // on-chain + not-expired only
  });
});
```

- [ ] **Step 5A.2: Run — expect failure**

Run: `npm test -- tests/verify.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 5A.3: Implement `server/utils/verify-credential.ts`**

```ts
import { verifyVC, type SignedVC } from './w3c-vc';
import type { SchemaDoc } from '~/lib/types/schema';

export interface SinkCredential {
  id: string;
  issuer: string;
  subject: string;
  credential_type: string;
  uri?: string;
  expiration?: number; // Ripple epoch seconds; 0 means none
  status: 'created' | 'accepted' | 'revoked';
}

export interface SinkSchema {
  uid: string;
  schema_json: SchemaDoc;
}

export interface VerifyResult {
  valid: boolean;
  checks: {
    onChain: boolean;
    notExpired: boolean;
    proofValid: boolean | null;
    schemaMatch: boolean | null;
  };
  reasons: string[];
}

const RIPPLE_EPOCH_OFFSET = 946684800;

export function verifyCredentialPayload(
  cred: SinkCredential,
  schema: SinkSchema,
  vc: SignedVC | null
): VerifyResult {
  const reasons: string[] = [];

  const onChain = cred.status !== 'revoked';
  if (!onChain) reasons.push('credential has been revoked');

  const nowRipple = Math.floor(Date.now() / 1000) - RIPPLE_EPOCH_OFFSET;
  const notExpired = !cred.expiration || cred.expiration > nowRipple;
  if (!notExpired) reasons.push('credential has expired');

  let proofValid: boolean | null = null;
  let schemaMatch: boolean | null = null;
  if (vc) {
    proofValid = verifyVC(vc);
    if (!proofValid) reasons.push('VC proof signature is invalid');

    const expectedId = `xcs:schema:${schema.uid}`;
    schemaMatch = vc.credentialSchema?.id === expectedId;
    if (!schemaMatch) reasons.push('VC schema id does not match registered schema');
  }

  const valid =
    onChain &&
    notExpired &&
    (proofValid === null || proofValid) &&
    (schemaMatch === null || schemaMatch);

  return { valid, checks: { onChain, notExpired, proofValid, schemaMatch }, reasons };
}
```

- [ ] **Step 5A.4: Run — expect pass**

Run: `npm test -- tests/verify.test.ts`
Expected: 6 passed.

### Task 5B — HTTP endpoint

- [ ] **Step 5B.1: Implement `server/api/credential/verify.get.ts`**

```ts
import { db } from '../../db';
import { fetchJSON } from '../../utils/ipfs';
import { verifyCredentialPayload, type SinkSchema, type SinkCredential } from '../../utils/verify-credential';
import type { SignedVC } from '../../utils/w3c-vc';

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const id = typeof query.id === 'string' ? query.id : '';
  if (!id) {
    throw createError({ statusCode: 400, message: 'id query param required' });
  }

  const [cred] = await db<SinkCredential[]>`
    SELECT id, issuer, subject, credential_type, uri, expiration, status
      FROM credentials WHERE id = ${id} LIMIT 1
  `;
  if (!cred) {
    throw createError({ statusCode: 404, message: 'credential not found in sink' });
  }

  const [schema] = await db<SinkSchema[]>`
    SELECT uid, schema_json FROM schemas WHERE uid = ${cred.credential_type} LIMIT 1
  `;
  if (!schema) {
    throw createError({ statusCode: 404, message: 'schema not found in sink' });
  }

  let vc: SignedVC | null = null;
  if (cred.uri) {
    const cidMatch = cred.uri.match(/\/ipfs\/([A-Za-z0-9]+)/);
    if (cidMatch) {
      try {
        vc = await fetchJSON<SignedVC>(cidMatch[1]!);
      } catch (err) {
        // VC fetch failures don't fail the whole verify — they leave proof=null.
        console.warn('verify: failed to fetch VC from', cred.uri, err);
      }
    }
  }

  const result = verifyCredentialPayload(cred, schema, vc);
  return { success: true, data: { credentialId: cred.id, ...result } };
});
```

- [ ] **Step 5B.2: Add a verify page `app/pages/verify.vue`**

```vue
<template>
  <div class="max-w-2xl mx-auto py-8 px-4">
    <h1 class="text-3xl font-bold mb-6">Verify Credential</h1>

    <div class="flex gap-3 mb-6">
      <input v-model="credentialId" placeholder="issuer:subject:credentialType"
             class="flex-1 px-4 py-2 border rounded-lg" />
      <button @click="run" :disabled="!credentialId || loading"
              class="px-6 py-2 bg-primary text-white rounded-lg">
        {{ loading ? 'Checking…' : 'Verify' }}
      </button>
    </div>

    <div v-if="result" class="border rounded-lg p-4">
      <p class="text-lg font-semibold" :class="result.valid ? 'text-green-600' : 'text-red-600'">
        {{ result.valid ? '✓ Valid' : '✗ Invalid' }}
      </p>
      <ul class="mt-3 text-sm space-y-1">
        <li>On-chain (not revoked): {{ result.checks.onChain }}</li>
        <li>Not expired: {{ result.checks.notExpired }}</li>
        <li>Proof valid: {{ result.checks.proofValid ?? 'n/a (private)' }}</li>
        <li>Schema match: {{ result.checks.schemaMatch ?? 'n/a (private)' }}</li>
      </ul>
      <ul v-if="result.reasons.length" class="mt-3 text-sm text-red-600 list-disc pl-5">
        <li v-for="r in result.reasons" :key="r">{{ r }}</li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
const credentialId = ref('');
const loading = ref(false);
const result = ref<any>(null);

async function run() {
  loading.value = true;
  try {
    const res = await $fetch<{ success: boolean; data: any }>(
      '/api/credential/verify',
      { params: { id: credentialId.value } }
    );
    result.value = res.data;
  } catch (e: any) {
    result.value = { valid: false, checks: {}, reasons: [e?.data?.message || e.message] };
  } finally {
    loading.value = false;
  }
}
</script>
```

- [ ] **Step 5B.3: Run all tests**

Run: `npm test`
Expected: green.

- [ ] **Step 5B.4: Commit**

```bash
git add server/utils/verify-credential.ts server/api/credential/verify.get.ts \
        app/pages/verify.vue tests/verify.test.ts
git commit -m "feat(verify): add credential verification endpoint and UI"
```

---

## Phase 6 — Wallet-Based Subject Acceptance

The current `/credentials/accept` page asks the subject to paste their seed. We replace that with `xrpl-connect`'s wallet flow: the subject connects their wallet, signs a `CredentialAccept` tx client-side, and submits the signed blob to a new server endpoint that just broadcasts it.

**Files:**
- Modify: `server/utils/validation.ts`
- Create: `server/api/credential/accept-signed.post.ts`
- Modify: `server/utils/xrpl.ts` (add `submitSigned`)
- Modify: `app/pages/credentials/accept.vue`
- Modify: `app/components/credential/CredentialAcceptance.vue`

- [ ] **Step 6.1: Add `acceptSignedSchema`**

In `server/utils/validation.ts`, append:

```ts
export const acceptSignedSchema = z.object({
  signedTxBlob: z.string().min(1),
});
```

- [ ] **Step 6.2: Add `submitSigned` to `XRPLClient`**

In `server/utils/xrpl.ts`, inside the class, add:

```ts
  async submitSigned(signedTxBlob: string) {
    await this.connect();
    const response = await this.client.submit(signedTxBlob, { failHard: true });
    if (response.result.engine_result !== 'tesSUCCESS' &&
        response.result.engine_result !== 'terQUEUED') {
      throw new Error(`XRPL submit failed: ${response.result.engine_result}`);
    }
    return {
      txHash: response.result.tx_json.hash,
      engineResult: response.result.engine_result,
    };
  }
```

- [ ] **Step 6.3: Create `server/api/credential/accept-signed.post.ts`**

```ts
import { acceptSignedSchema } from '../../utils/validation';
import { useXRPL } from '../../utils/xrpl';

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event);
    const { signedTxBlob } = acceptSignedSchema.parse(body);

    const xrpl = useXRPL();
    const result = await xrpl.submitSigned(signedTxBlob);

    return { success: true, data: result };
  } catch (error: any) {
    if (error.statusCode) throw error;
    console.error('Error submitting signed accept:', error);
    throw createError({
      statusCode: 500,
      message: error.message || 'Failed to submit signed transaction',
    });
  }
});
```

- [ ] **Step 6.4: Rewrite `app/pages/credentials/accept.vue`**

Replace the entire file with the wallet-driven flow. The existing `CredentialAcceptance.vue` child emits `accept` with a seed today; we'll change its contract in 6.5.

```vue
<template>
  <div class="max-w-4xl mx-auto py-8 px-4">
    <div class="mb-8 flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-bold mb-2">Accept Credentials</h1>
        <p class="text-gray-600">
          Connect your wallet to see and accept credentials issued to your address.
        </p>
      </div>
      <div>
        <button v-if="!connected" @click="connect()"
                class="px-4 py-2 bg-primary text-white rounded-lg">
          Connect Wallet
        </button>
        <div v-else class="text-sm">
          <p class="font-mono">{{ address }}</p>
          <button class="text-xs underline" @click="disconnect()">Disconnect</button>
        </div>
      </div>
    </div>

    <div v-if="!connected" class="text-center py-12 bg-gray-50 rounded-lg">
      <p>Please connect your wallet to view pending credentials.</p>
    </div>

    <div v-else-if="pendingCredentials.length === 0"
         class="text-center py-12 bg-gray-50 rounded-lg">
      <p>No pending credentials for {{ address }}.</p>
    </div>

    <div v-else class="space-y-6">
      <CredentialAcceptance
        v-for="credential in pendingCredentials"
        :key="credential.id"
        :credential="credential"
        @accept="() => handleAccept(credential)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Credential } from '~/lib/types/schema';

const toast = useToast();
const { connected, address, connect, disconnect, sign } = useWallet();

const { data: credentialsData, refresh } = await useFetch('/api/credential/list', {
  method: 'POST',
  body: computed(() => ({
    subject: address.value || undefined,
    status: 'created',
  })),
  watch: [address],
});

const pendingCredentials = computed(
  () => (credentialsData.value?.data?.credentials as unknown as Credential[]) || []
);

async function handleAccept(credential: Credential) {
  try {
    const tx = {
      TransactionType: 'CredentialAccept' as const,
      Account: address.value!,
      Issuer: credential.issuer,
      CredentialType: credential.credential_type,
    };
    const signed = await sign(tx);
    const blob = (signed as any).tx_blob ?? (signed as any).signedTransaction ?? signed;

    const res = await $fetch<{ success: boolean; data: { txHash: string } }>(
      '/api/credential/accept-signed',
      { method: 'POST', body: { signedTxBlob: blob } }
    );

    toast.add({
      title: 'Submitted',
      description: `Tx ${res.data.txHash.slice(0, 12)}… submitted to XRPL.`,
      color: 'success',
    });

    await refresh();
  } catch (e: any) {
    toast.add({
      title: 'Error',
      description: e?.data?.message || e.message || 'Failed to accept credential',
      color: 'error',
    });
  }
}
</script>
```

- [ ] **Step 6.5: Update `CredentialAcceptance.vue` to drop the seed input**

Open `app/components/credential/CredentialAcceptance.vue`. Remove the seed `<input>` and any internal state for the seed. The accept button should now `@click="$emit('accept')"` with no payload. Remove the seed parameter from the emit type definition.

- [ ] **Step 6.6: Manual smoke test**

1. `npm run dev`
2. Visit `/credentials/accept`
3. Click "Connect Wallet" — flow should match the connect UX used elsewhere in the app
4. Issue a credential to your wallet address (from another browser or via `curl`)
5. The pending credential should appear; click "Accept" and approve in the wallet
6. Toast shows the tx hash; after the next ledger close + sink lag, the credential moves out of pending

If the wallet plugin isn't fully functional in your dev environment, leave the change in place and mark this step `[~]` with a note.

- [ ] **Step 6.7: Commit**

```bash
git add server/utils/validation.ts server/utils/xrpl.ts \
        server/api/credential/accept-signed.post.ts \
        app/pages/credentials/accept.vue \
        app/components/credential/CredentialAcceptance.vue
git commit -m "feat(accept): use wallet-signed CredentialAccept instead of seed paste"
```

- [ ] **Step 6.8: Delete the obsolete seed-based endpoint**

Once 6.6 succeeds, the old `accept.post.ts` is dead code (frontend no longer calls it; nothing else does). Delete it:

```bash
git rm server/api/credential/accept.post.ts
git commit -m "refactor: remove seed-based accept endpoint (replaced by accept-signed)"
```

If you are unsure whether external integrations rely on it, skip the delete — leaving it is harmless. Document the deprecation in the README in that case.

---

## Phase 7 — Indexer-Latency UX

Today the API returns `txHash` and the UI shows success immediately, but the sink may take a few seconds to index the new row. We add `useIndexerWait(predicate, opts)` that polls the appropriate `/api/...` until the predicate is true, then resolves. We use it on the schema-create, credential-issue, accept, and revoke flows.

**Files:**
- Create: `app/composables/useIndexerWait.ts`
- Test: `tests/use-indexer-wait.test.ts`
- Modify: `app/pages/schemas/create.vue`
- Modify: `app/pages/credentials/issue.vue`
- (acceptance flow already polls via `refresh()` — leave for now)

- [ ] **Step 7.1: Write `tests/use-indexer-wait.test.ts`**

The composable is pure (it only takes a `fetcher` and a `predicate`), so we test it without Vue.

```ts
import { describe, it, expect, vi } from 'vitest';
import { waitForIndexer } from '../app/composables/useIndexerWait';

describe('waitForIndexer', () => {
  it('returns the first value matching the predicate', async () => {
    let n = 0;
    const fetcher = vi.fn(async () => ++n);
    const result = await waitForIndexer({
      fetcher,
      predicate: (v) => v >= 3,
      intervalMs: 1,
      timeoutMs: 1000,
    });
    expect(result).toBe(3);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('rejects after timeout', async () => {
    const fetcher = vi.fn(async () => null);
    await expect(
      waitForIndexer({
        fetcher,
        predicate: (v) => v !== null,
        intervalMs: 5,
        timeoutMs: 30,
      })
    ).rejects.toThrow(/timeout/i);
  });

  it('swallows transient fetcher errors and keeps polling', async () => {
    let calls = 0;
    const fetcher = vi.fn(async () => {
      calls++;
      if (calls < 3) throw new Error('boom');
      return 'ok';
    });
    const result = await waitForIndexer({
      fetcher,
      predicate: (v) => v === 'ok',
      intervalMs: 1,
      timeoutMs: 1000,
    });
    expect(result).toBe('ok');
  });
});
```

- [ ] **Step 7.2: Run — expect failure**

Run: `npm test -- tests/use-indexer-wait.test.ts`
Expected: FAIL.

- [ ] **Step 7.3: Implement `app/composables/useIndexerWait.ts`**

```ts
import { ref, type Ref } from 'vue';

export interface WaitOptions<T> {
  fetcher: () => Promise<T>;
  predicate: (v: T) => boolean;
  intervalMs?: number;
  timeoutMs?: number;
}

export async function waitForIndexer<T>(opts: WaitOptions<T>): Promise<T> {
  const interval = opts.intervalMs ?? 1500;
  const timeout = opts.timeoutMs ?? 60_000;
  const start = Date.now();

  while (Date.now() - start < timeout) {
    try {
      const value = await opts.fetcher();
      if (opts.predicate(value)) return value;
    } catch {
      // swallow transient errors
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`indexer wait timeout after ${timeout}ms`);
}

export function useIndexerWait() {
  const waiting: Ref<boolean> = ref(false);

  async function wait<T>(opts: WaitOptions<T>): Promise<T> {
    waiting.value = true;
    try {
      return await waitForIndexer(opts);
    } finally {
      waiting.value = false;
    }
  }

  return { waiting, wait };
}
```

- [ ] **Step 7.4: Run — expect pass**

Run: `npm test -- tests/use-indexer-wait.test.ts`
Expected: 3 passed.

- [ ] **Step 7.5: Use it in `app/pages/schemas/create.vue`**

After the create-call resolves with `data.uid`, before navigating or showing final success, add:

```ts
const { waiting, wait } = useIndexerWait();

await wait({
  fetcher: () => $fetch(`/api/schema?id=${result.uid}`),
  predicate: (r: any) => !!r?.data?.uid,
});
```

In the template, while `waiting === true`, show a "Waiting for ledger to confirm…" line under the success message.

- [ ] **Step 7.6: Use it in `app/pages/credentials/issue.vue`**

Same pattern, but predicate checks the credentials list:

```ts
await wait({
  fetcher: () => $fetch('/api/credential/list', {
    method: 'POST',
    body: { issuer: result.issuer, subject: form.subject, credentialType: form.credentialType, limit: 1 },
  }),
  predicate: (r: any) => (r?.data?.credentials?.length ?? 0) > 0,
});
```

(`result.issuer` may not be in the response yet — if so, fetch it from the runtime config endpoint or accept that the predicate matches on `subject + credentialType` alone.)

- [ ] **Step 7.7: Commit**

```bash
git add app/composables/useIndexerWait.ts tests/use-indexer-wait.test.ts \
        app/pages/schemas/create.vue app/pages/credentials/issue.vue
git commit -m "feat(ux): poll sink for indexed record before claiming success"
```

---

## Phase 8 — Schema Versioning (parent_uid)

Allow new schemas to declare a `parent_uid` (the prior version's UID). The substream stores it; the API exposes "version chain"; the UI's `SchemaVersionHistory.vue` walks the chain.

**Files:**
- Modify: `substreams/proto/xcs.proto` (add `parent_uid` to `SchemaRegistration`)
- Modify: `substreams/src/lib.rs`
- Modify: `substreams/schema.sql`
- Modify: `server/utils/xrpl.ts` (memo with parent UID)
- Modify: `server/utils/validation.ts`
- Modify: `server/api/schema/create.post.ts`
- Modify: `server/api/schema/index.get.ts` (return parent + descendants)
- Modify: `app/components/schema/SchemaVersionHistory.vue`

**Memo design:** add a third optional memo `xcs:parent_uid` carrying the parent's UID (hex). The substream picks it up; absence = root version.

### Task 8A — Substream changes (Rust)

- [ ] **Step 8A.1: Edit `substreams/proto/xcs.proto`**

Find the `SchemaRegistration` message (the existing one). Add a field:

```proto
  string parent_uid = 4;  // optional; empty when this is a root schema
```

Use whatever field number is next available (likely 4; check the file).

- [ ] **Step 8A.2: Add memo constant + parser in `substreams/src/lib.rs`**

Below the existing memo constants, add:

```rust
const MEMO_PARENT_UID: &[u8] = b"xcs:parent_uid";
```

In both `map_schema_ops` and `map_xcs_ops` (the Payment branch in `map_xcs_ops` mirrors `map_schema_ops`), after locating the `xcs:schema_register` memo, also extract an optional parent UID:

```rust
let parent_uid = tx
    .memos
    .iter()
    .find(|m| memo_type_matches(&m.memo_type, MEMO_PARENT_UID))
    .and_then(|m| decode_memo_data(&m.memo_data))
    .unwrap_or_default();
```

Set it on the emitted `SchemaRegistration`:

```rust
op: Some(Op::SchemaReg(SchemaRegistration {
    issuer: tx.account.clone(),
    schema_json,
    uid,
    parent_uid,
})),
```

- [ ] **Step 8A.3: Persist `parent_uid` in `db_out`**

In the `Op::SchemaReg` arm of `db_out`, add:

```rust
.set("parent_uid", s.parent_uid.as_str())
```

- [ ] **Step 8A.4: Edit `substreams/schema.sql`**

Add a column + index to the `schemas` table:

```sql
-- Add after the existing `schemas_issuer_idx` index:
ALTER TABLE schemas ADD COLUMN IF NOT EXISTS parent_uid TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS schemas_parent_uid_idx ON schemas (parent_uid);
```

Also update the `CREATE TABLE` statement to include `parent_uid TEXT NOT NULL DEFAULT ''` for fresh installs (so re-creating from scratch does not need the ALTER).

- [ ] **Step 8A.5: Rebuild + repack the substream**

```bash
cd substreams
cargo build --target wasm32-unknown-unknown --release
substreams pack
```

Expected: a new `xcs-vX.Y.Z.spkg` file. Bump the version in `substreams.yaml` if appropriate.

- [ ] **Step 8A.6: Re-run sink setup (drops + recreates schemas table for dev)**

If you can afford to wipe the local sink DB (dev only):

```bash
substreams-sink-sql setup "$DATABASE_URL" ./substreams/substreams.yaml
```

If you cannot drop the table, run the ALTER TABLE statement from 8A.4 manually against the running DB:

```bash
psql "$DATABASE_URL" -c "ALTER TABLE schemas ADD COLUMN IF NOT EXISTS parent_uid TEXT NOT NULL DEFAULT '';"
```

- [ ] **Step 8A.7: Commit (Rust + SQL)**

```bash
git add substreams/proto/xcs.proto substreams/src/lib.rs substreams/schema.sql substreams/substreams.yaml substreams/xcs-*.spkg
git commit -m "feat(substream): index optional parent_uid for schema versioning"
```

### Task 8B — API + UI

- [ ] **Step 8B.1: Validation accepts `parentUid`**

Edit the `createSchemaSchema` block in `server/utils/validation.ts`:

```ts
export const createSchemaSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/).default('1.0.0'),
  fields: z.array(schemaFieldSchema).min(1),
  isPublic: z.boolean().default(false),
  parentUid: z.string().regex(/^[0-9a-f]{64}$/).optional(),
});
```

- [ ] **Step 8B.2: `xrpl.ts` adds the optional memo**

In `server/utils/xrpl.ts`, extend the `registerSchema` arg type and append the memo when present (mirrors the `ipfsCid` pattern from Phase 3):

```ts
        ...(schemaDoc.parentUid
          ? [{
              Memo: {
                MemoType: convertStringToHex('xcs:parent_uid'),
                MemoData: convertStringToHex(schemaDoc.parentUid),
              },
            }]
          : []),
```

Also update the `SchemaDoc` type in `app/lib/types/schema.ts` to include `parentUid?: string`.

- [ ] **Step 8B.3: Validate parent existence in `create.post.ts`**

Before pinning/registering, if `parentUid` is set, confirm it resolves in the sink:

```ts
if (validated.parentUid) {
  const [parent] = await db`SELECT uid, issuer FROM schemas WHERE uid = ${validated.parentUid} LIMIT 1`;
  if (!parent) {
    throw createError({
      statusCode: 400,
      message: 'parentUid does not exist in the registry',
    });
  }
  // Optional: enforce that only the original issuer can extend a schema.
  // Skip this for now — protocol leaves authorship open.
}
```

Pass `parentUid: validated.parentUid` into `xrpl.registerSchema({ ..., parentUid })`.

- [ ] **Step 8B.4: `index.get.ts` returns the version chain**

Read the current `server/api/schema/index.get.ts`. After the schema is fetched, also fetch ancestors and descendants:

```ts
// Walk parent chain
const ancestors: any[] = [];
let cursor = schema.parent_uid;
while (cursor) {
  const [row] = await db`SELECT uid, parent_uid, schema_json, ledger_index FROM schemas WHERE uid = ${cursor} LIMIT 1`;
  if (!row) break;
  ancestors.unshift(row);
  cursor = row.parent_uid;
}

const descendants = await db`SELECT uid, parent_uid, schema_json, ledger_index FROM schemas WHERE parent_uid = ${schema.uid}`;

return { success: true, data: { schema, ancestors, descendants } };
```

- [ ] **Step 8B.5: Update `SchemaVersionHistory.vue` to render the chain**

Open `app/components/schema/SchemaVersionHistory.vue`. Replace its data-fetching to call `/api/schema?id=...` (it now returns `ancestors` + `descendants`) and render them as a vertical list with version numbers and links. Keep the existing styling.

- [ ] **Step 8B.6: Manual smoke test**

```bash
# Create a root schema
ROOT=$(curl -s -X POST http://localhost:3000/api/schema/create \
  -H 'content-type: application/json' \
  -d '{"name":"Root","version":"1.0.0","fields":[{"name":"x","type":"string","required":true}]}' | jq -r .data.uid)

# Wait a few seconds for sink, then create a child
sleep 5
curl -s -X POST http://localhost:3000/api/schema/create \
  -H 'content-type: application/json' \
  -d "{\"name\":\"Child\",\"version\":\"1.1.0\",\"fields\":[{\"name\":\"x\",\"type\":\"string\",\"required\":true}],\"parentUid\":\"$ROOT\"}" | jq

sleep 5
curl -s "http://localhost:3000/api/schema?id=$ROOT" | jq '.data.descendants'
```

Expected: descendants array contains the child schema.

- [ ] **Step 8B.7: Commit**

```bash
git add server/utils/validation.ts server/utils/xrpl.ts app/lib/types/schema.ts \
        server/api/schema/create.post.ts server/api/schema/index.get.ts \
        app/components/schema/SchemaVersionHistory.vue
git commit -m "feat(schema): expose parent/descendant version chain in API and UI"
```

---

## Phase 9 — Expiration Enforcement

The substream already stores `expiration` (Ripple time). We expose a filter `excludeExpired` in `list`, compute an `isExpired` flag in API responses, and render an "Expired" badge in `CredentialCard`.

**Files:**
- Modify: `server/utils/validation.ts`
- Modify: `server/api/credential/list.post.ts`
- Modify: `server/api/credential/index.get.ts`
- Modify: `app/components/credential/CredentialCard.vue`

- [ ] **Step 9.1: Add filter to validation**

In `listCredentialsSchema`, add:

```ts
  excludeExpired: z.boolean().default(false),
```

- [ ] **Step 9.2: Apply filter in `list.post.ts`**

Read the current SQL builder; append a clause when `excludeExpired` is true:

```ts
const nowRipple = Math.floor(Date.now() / 1000) - 946684800;
// inside the WHERE composition:
if (validated.excludeExpired) {
  conditions.push(db`(expiration IS NULL OR expiration = 0 OR expiration > ${nowRipple})`);
}
```

(Adapt to the file's existing query style — if it uses raw `db\`SELECT … WHERE …\`` strings, add the clause inline with proper interpolation.)

- [ ] **Step 9.3: Compute `isExpired` in responses**

Both `index.get.ts` and `list.post.ts` should add an `isExpired` boolean to each returned credential:

```ts
const nowRipple = Math.floor(Date.now() / 1000) - 946684800;
const decorate = (c: any) => ({
  ...c,
  isExpired: !!c.expiration && c.expiration > 0 && c.expiration <= nowRipple,
});
```

Apply `decorate` to single-credential and array responses respectively.

- [ ] **Step 9.4: Show badge in `CredentialCard.vue`**

Open `app/components/credential/CredentialCard.vue`. Where status is rendered, add:

```vue
<span v-if="credential.isExpired"
      class="px-2 py-0.5 text-xs rounded bg-red-100 text-red-800">
  Expired
</span>
```

If the existing card already has a status badge, render the expired badge alongside it.

- [ ] **Step 9.5: Manual smoke test**

```bash
# Issue a credential expiring in 5 seconds (Ripple time)
NOW=$(date +%s)
EXP=$(( NOW + 5 ))
EXP_ISO=$(date -u -r $EXP +"%Y-%m-%dT%H:%M:%SZ")

curl -s -X POST http://localhost:3000/api/credential/issue \
  -H 'content-type: application/json' \
  -d "{\"credentialType\":\"<UID>\",\"subject\":\"rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe\",\"data\":{\"x\":\"y\"},\"expiresAt\":\"$EXP_ISO\"}" | jq

sleep 15
curl -s -X POST http://localhost:3000/api/credential/list \
  -H 'content-type: application/json' \
  -d '{"subject":"rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe","excludeExpired":true}' | jq '.data.credentials | length'
```

Expected: the expired credential is excluded from the filtered list, and shows `isExpired: true` in an unfiltered call.

- [ ] **Step 9.6: Commit**

```bash
git add server/utils/validation.ts server/api/credential/list.post.ts \
        server/api/credential/index.get.ts app/components/credential/CredentialCard.vue
git commit -m "feat(credential): filter and badge expired credentials"
```

---

## Final Verification

- [ ] **Run the whole test suite**

```bash
npm test
```

Expected: all suites green.

- [ ] **Type-check the project**

```bash
npx nuxi typecheck
```

Expected: no errors. (If pre-existing errors surface, list them and fix only those introduced by this plan.)

- [ ] **Update CLAUDE.md status checklist**

Open the project root `CLAUDE.md`. Update the "Current Project Status" sections to reflect:
- IPFS integration: ✅
- W3C VC utilities: ✅
- Verify endpoint: ✅
- Wallet-based acceptance: ✅
- Schema versioning: ✅
- Expiration enforcement: ✅

- [ ] **Commit final docs**

```bash
git add CLAUDE.md
git commit -m "docs: mark Phase 1–9 spec gaps as resolved"
```

---

## Out of Scope (deferred)

These items from the audit/white-paper are intentionally not in this plan:

- **Selective disclosure / ZK proofs** — explicit MVP non-goal in the white-paper
- **Schema authorship enforcement** — anyone can extend any schema; no protocol-level access control
- **Webhooks for credential events** — listed in CLAUDE.md as future enhancement
- **Schema marketplace / analytics dashboard** — future enhancement
- **Auto-discovery of `FIREHOSE_START_BLOCK`** — operational tooling, not a spec gap
