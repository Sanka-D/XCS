import { describe, expect, it } from 'vitest'

import {
  assertWalletSupportsXcsTransaction,
  normalizeWalletTransactionError,
  parseWalletCredentialTransactionError,
  walletCredentialSupport,
} from '../app/utils/walletCompatibility'

const gemWallet = { id: 'gemwallet', name: 'GemWallet' }
const xaman = { id: 'xaman', name: 'Xaman' }
const crossmark = { id: 'crossmark', name: 'Crossmark' }

describe('wallet Credential transaction compatibility', () => {
  it.each(['CredentialCreate', 'CredentialAccept', 'CredentialDelete'] as const)(
    'blocks GemWallet before a %s signing attempt',
    (transactionType) => {
      expect(() => assertWalletSupportsXcsTransaction(gemWallet, transactionType)).toThrowError(
        `WALLET_CREDENTIAL_TRANSACTION_UNSUPPORTED:gemwallet:${transactionType}`,
      )
    },
  )

  it('keeps GemWallet available for schema-registration Payments', () => {
    expect(() => assertWalletSupportsXcsTransaction(gemWallet, 'Payment')).not.toThrow()
  })

  it('does not claim that unqualified adapters have native Credential support', () => {
    expect(walletCredentialSupport('xaman')).toBe('supported')
    expect(walletCredentialSupport('gemwallet')).toBe('unsupported')
    expect(walletCredentialSupport('crossmark')).toBe('unverified')
    expect(() => assertWalletSupportsXcsTransaction(xaman, 'CredentialCreate')).not.toThrow()
    expect(() => assertWalletSupportsXcsTransaction(crossmark, 'CredentialCreate')).not.toThrow()
  })

  it('maps the exact nested pre-Credentials codec error to an actionable stable code', () => {
    const original = new Error('Invalid field TransactionType: CredentialCreate')
    const wrapped = Object.assign(new Error('Failed to sign transaction.'), {
      originalError: original,
    })

    const normalized = normalizeWalletTransactionError(wrapped, crossmark, 'CredentialCreate')

    expect(normalized.message).toBe(
      'WALLET_CREDENTIAL_TRANSACTION_UNSUPPORTED:crossmark:CredentialCreate',
    )
    expect(normalized.cause).toBe(wrapped)
  })

  it('preserves unrelated wallet errors and transaction types', () => {
    const rejected = new Error('User rejected the request')
    const broaderDiagnostic = new Error(
      'Retry failed after Invalid field TransactionType: CredentialCreate while loading the account',
    )

    expect(normalizeWalletTransactionError(rejected, crossmark, 'CredentialCreate')).toBe(rejected)
    expect(normalizeWalletTransactionError(broaderDiagnostic, crossmark, 'CredentialCreate')).toBe(
      broaderDiagnostic,
    )
    expect(
      normalizeWalletTransactionError(
        new Error('Invalid field TransactionType: CredentialCreate'),
        crossmark,
        'Payment',
      ).message,
    ).toBe('Invalid field TransactionType: CredentialCreate')
  })

  it('parses only complete, safe compatibility codes for localized display', () => {
    expect(
      parseWalletCredentialTransactionError(
        'WALLET_CREDENTIAL_TRANSACTION_UNSUPPORTED:gemwallet:CredentialDelete',
      ),
    ).toEqual({
      walletId: 'gemwallet',
      walletName: 'GemWallet',
      transactionType: 'CredentialDelete',
    })
    expect(
      parseWalletCredentialTransactionError(
        'WALLET_CREDENTIAL_TRANSACTION_UNSUPPORTED:gemwallet:Payment',
      ),
    ).toBeNull()
    expect(
      parseWalletCredentialTransactionError(
        'WALLET_CREDENTIAL_TRANSACTION_UNSUPPORTED:<script>:CredentialCreate',
      ),
    ).toBeNull()
  })
})
