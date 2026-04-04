import { getAddress } from "ethers";

const MIRROR_BASE =
  (import.meta.env.VITE_HEDERA_MIRROR_BASE as string | undefined)?.trim().replace(/\/$/, "") ??
  "https://testnet.mirrornode.hedera.com";

/** Resolve `0.0.x` from an EVM address using the Hedera mirror (`/api/v1/accounts/{evm}`). */
export async function resolveHederaAccountIdFromEvm(evmAddress: string): Promise<string | null> {
  try {
    const addr = getAddress(evmAddress);
    const r = await fetch(`${MIRROR_BASE}/api/v1/accounts/${addr}`);
    if (!r.ok) return null;
    const j = (await r.json()) as { account?: string };
    const id = j.account?.trim();
    return id && /^\d+\.\d+\.\d+$/.test(id) ? id : null;
  } catch {
    return null;
  }
}
