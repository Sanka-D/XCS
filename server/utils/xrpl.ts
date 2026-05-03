import { Client, Wallet, convertStringToHex } from 'xrpl';
import { createHash } from 'crypto';
import type { SchemaDoc } from '~/lib/types/schema';

/**
 * Deterministic schema UID — must match the Rust implementation in substreams/src/lib.rs:
 *   SHA256(schema_json_bytes || issuer_bytes || ledger_index_be64 || tx_index_be32)
 */
function computeSchemaUid(
  schemaJson: string,
  issuer: string,
  ledgerIndex: number,
  txIndex: number
): string {
  const h = createHash('sha256');
  h.update(Buffer.from(schemaJson, 'utf8'));
  h.update(Buffer.from(issuer, 'utf8'));
  const ledgerBuf = Buffer.alloc(8);
  ledgerBuf.writeBigUInt64BE(BigInt(ledgerIndex));
  h.update(ledgerBuf);
  const txBuf = Buffer.alloc(4);
  txBuf.writeUInt32BE(txIndex);
  h.update(txBuf);
  return h.digest('hex');
}

class XRPLClient {
  private client: Client;
  private issuerWallet: Wallet;

  constructor() {
    const config = useRuntimeConfig();
    this.client = new Client(config.xrplServer);
    this.issuerWallet = Wallet.fromSeed(config.issuerSeed);
  }

  async connect() {
    if (!this.client.isConnected()) {
      await this.client.connect();
    }
  }

  async disconnect() {
    if (this.client.isConnected()) {
      await this.client.disconnect();
    }
  }

  getIssuerAddress() {
    return this.issuerWallet.address;
  }

  /**
   * Register a schema on XRPL by sending a Payment tx with xcs:schema_register memo.
   * Returns the tx hash and the deterministic schema UID computed from the confirmed ledger position.
   */
  async registerSchema(schemaDoc: SchemaDoc) {
    await this.connect();

    const config = useRuntimeConfig();
    // JSON must use a consistent key ordering for reproducible UID computation.
    // Key insertion order matches SchemaDoc interface: name, description, version, fields.
    const schemaTx: Record<string, unknown> = {
      name: schemaDoc.name,
      version: schemaDoc.version,
      fields: schemaDoc.fields,
    };
    if (schemaDoc.description) {
      // Insert after name to maintain consistent ordering
      schemaTx.description = schemaDoc.description;
    }

    // Always produce the same key order: name, description (optional), version, fields
    const orderedDoc: Record<string, unknown> = { name: schemaTx.name };
    if (schemaTx.description) orderedDoc.description = schemaTx.description;
    orderedDoc.version = schemaTx.version;
    orderedDoc.fields = schemaTx.fields;

    const schemaJson = JSON.stringify(orderedDoc);

    const tx = {
      TransactionType: 'Payment' as const,
      Account: this.issuerWallet.address,
      Destination: config.xrplRegistryAddress,
      Amount: '1', // 1 drop
      Memos: [
        {
          Memo: {
            MemoType: convertStringToHex('xcs:schema_register'),
            MemoData: convertStringToHex(schemaJson),
          },
        },
      ],
    };

    const response = await this.client.submitAndWait(tx, {
      autofill: true,
      wallet: this.issuerWallet,
    });

    if (
      (response.result.meta as any).TransactionResult !== 'tesSUCCESS'
    ) {
      throw new Error(
        `XRPL transaction failed: ${(response.result.meta as any).TransactionResult}`
      );
    }

    const txIndex = (response.result.meta as any).TransactionIndex ?? 0;
    const ledgerIndex = response.result.ledger_index ?? 0;
    const uid = computeSchemaUid(
      schemaJson,
      this.issuerWallet.address,
      ledgerIndex,
      txIndex
    );

    return {
      uid,
      txHash: response.result.hash,
      ledgerIndex,
    };
  }

  /**
   * Issue a credential on XRPL via CredentialCreate with xcs:credential_create memo.
   * credentialType must be the schema UID (hex string) as returned by registerSchema.
   */
  async createCredential(params: {
    subject: string;
    credentialType: string; // schema UID hex — passed directly as CredentialType
    uri?: string;
    expiresAt?: Date;
  }) {
    await this.connect();

    const tx: Record<string, unknown> = {
      TransactionType: 'CredentialCreate',
      Account: this.issuerWallet.address,
      Subject: params.subject,
      CredentialType: params.credentialType, // hex UID, no encoding
      Memos: [
        {
          Memo: {
            MemoType: convertStringToHex('xcs:credential_create'),
          },
        },
      ],
    };

    if (params.uri) {
      tx.URI = convertStringToHex(params.uri);
    }

    if (params.expiresAt) {
      tx.Expiration = this.dateToRippleTime(params.expiresAt);
    }

    const response = await this.client.submitAndWait(tx as any, {
      autofill: true,
      wallet: this.issuerWallet,
    });

    if (
      (response.result.meta as any).TransactionResult !== 'tesSUCCESS'
    ) {
      throw new Error(
        `XRPL transaction failed: ${(response.result.meta as any).TransactionResult}`
      );
    }

    return {
      txHash: response.result.hash,
      ledgerIndex: response.result.ledger_index,
    };
  }

  async acceptCredential(params: {
    subjectSeed: string;
    issuer: string;
    credentialType: string; // schema UID hex
  }) {
    await this.connect();

    const subjectWallet = Wallet.fromSeed(params.subjectSeed);

    const tx = {
      TransactionType: 'CredentialAccept' as const,
      Account: subjectWallet.address,
      Issuer: params.issuer,
      CredentialType: params.credentialType, // hex UID, no encoding
    };

    const response = await this.client.submitAndWait(tx, {
      autofill: true,
      wallet: subjectWallet,
    });

    if (
      (response.result.meta as any).TransactionResult !== 'tesSUCCESS'
    ) {
      throw new Error(
        `XRPL transaction failed: ${(response.result.meta as any).TransactionResult}`
      );
    }

    return {
      txHash: response.result.hash,
    };
  }

  async deleteCredential(params: {
    subject: string;
    credentialType: string; // schema UID hex
  }) {
    await this.connect();

    const tx = {
      TransactionType: 'CredentialDelete' as const,
      Account: this.issuerWallet.address,
      Subject: params.subject,
      CredentialType: params.credentialType, // hex UID, no encoding
    };

    const response = await this.client.submitAndWait(tx, {
      autofill: true,
      wallet: this.issuerWallet,
    });

    if (
      (response.result.meta as any).TransactionResult !== 'tesSUCCESS'
    ) {
      throw new Error(
        `XRPL transaction failed: ${(response.result.meta as any).TransactionResult}`
      );
    }

    return {
      txHash: response.result.hash,
    };
  }

  private dateToRippleTime(date: Date): number {
    return Math.floor(date.getTime() / 1000) - 946684800;
  }
}

let xrplClient: XRPLClient;

export function useXRPL() {
  if (!xrplClient) {
    xrplClient = new XRPLClient();
  }
  return xrplClient;
}
