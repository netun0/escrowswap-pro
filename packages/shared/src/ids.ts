import { keccak256, toUtf8Bytes } from "ethers";

export function toOnchainId(id: string): `0x${string}` {
  return keccak256(toUtf8Bytes(id.trim())) as `0x${string}`;
}

export function makeId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${random}`;
}
