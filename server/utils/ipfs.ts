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
