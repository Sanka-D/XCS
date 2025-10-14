import { createHelia } from 'helia';
import { unixfs } from '@helia/unixfs';
import { CID } from 'multiformats/cid';

class IPFSClient {
  private helia: any;
  private fs: any;
  private initialized: boolean = false;

  async init() {
    if (!this.initialized) {
      this.helia = await createHelia();
      this.fs = unixfs(this.helia);
      this.initialized = true;
    }
  }

  async publish(data: object): Promise<string> {
    try {
      await this.init();
      const jsonString = JSON.stringify(data, null, 2);
      const encoder = new TextEncoder();
      const bytes = encoder.encode(jsonString);

      const cid = await this.fs.addBytes(bytes);
      return cid.toString();
    } catch (error: any) {
      throw new Error(`IPFS publish failed: ${error.message}`);
    }
  }

  async get(cidString: string): Promise<any> {
    try {
      await this.init();
      const cid = CID.parse(cidString);

      const chunks: Uint8Array[] = [];
      for await (const chunk of this.fs.cat(cid)) {
        chunks.push(chunk);
      }

      // Concatenate all chunks
      const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
      const result = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }

      const decoder = new TextDecoder();
      const data = decoder.decode(result);
      return JSON.parse(data);
    } catch (error: any) {
      throw new Error(`IPFS get failed: ${error.message}`);
    }
  }

  async unpin(cidString: string): Promise<boolean> {
    try {
      await this.init();
      const cid = CID.parse(cidString);
      await this.helia.pins.rm(cid);
      return true;
    } catch (error: any) {
      console.error(`IPFS unpin failed: ${error.message}`);
      return false;
    }
  }

  buildGatewayUrl(cid: string): string {
    const config = useRuntimeConfig();
    const gateway = config.public.ipfsGateway || 'https://ipfs.io';
    return `${gateway}/ipfs/${cid}`;
  }

  async stop() {
    if (this.initialized && this.helia) {
      await this.helia.stop();
      this.initialized = false;
    }
  }
}

let ipfsClient: IPFSClient;

export function useIPFS() {
  if (!ipfsClient) {
    ipfsClient = new IPFSClient();
  }
  return ipfsClient;
}
