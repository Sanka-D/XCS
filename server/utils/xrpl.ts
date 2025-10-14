import { Client, Wallet } from 'xrpl';
import { stringToHex } from '@xrplf/isomorphic/dist/utils';

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

  async createCredential(params: {
    subject: string;
    credentialType: string;
    uri: string;
    expiresAt?: Date;
  }) {
    await this.connect();

    const tx = {
      TransactionType: 'CredentialCreate',
      Account: this.issuerWallet.address,
      Subject: params.subject,
      CredentialType: stringToHex(params.credentialType),
      URI: stringToHex(params.uri),
      Expiration: params.expiresAt
        ? this.dateToRippleTime(params.expiresAt)
        : undefined,
    };

    const response = await this.client.submitAndWait(tx, {
      autofill: true,
      wallet: this.issuerWallet,
    });

    if (response.result.meta.TransactionResult !== 'tesSUCCESS') {
      throw new Error(
        `XRPL transaction failed: ${response.result.meta.TransactionResult}`
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
    credentialType: string;
  }) {
    await this.connect();

    const subjectWallet = Wallet.fromSeed(params.subjectSeed);

    const tx = {
      TransactionType: 'CredentialAccept',
      Account: subjectWallet.address,
      Issuer: params.issuer,
      CredentialType: stringToHex(params.credentialType),
    };

    const response = await this.client.submitAndWait(tx, {
      autofill: true,
      wallet: subjectWallet,
    });

    if (response.result.meta.TransactionResult !== 'tesSUCCESS') {
      throw new Error(
        `XRPL transaction failed: ${response.result.meta.TransactionResult}`
      );
    }

    return {
      txHash: response.result.hash,
    };
  }

  async deleteCredential(params: { subject: string; credentialType: string }) {
    await this.connect();

    const tx = {
      TransactionType: 'CredentialDelete',
      Account: this.issuerWallet.address,
      Subject: params.subject,
      CredentialType: stringToHex(params.credentialType),
    };

    const response = await this.client.submitAndWait(tx, {
      autofill: true,
      wallet: this.issuerWallet,
    });

    if (response.result.meta.TransactionResult !== 'tesSUCCESS') {
      throw new Error(
        `XRPL transaction failed: ${response.result.meta.TransactionResult}`
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
