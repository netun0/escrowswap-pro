import { Contract, Interface, JsonRpcProvider, Wallet, keccak256, toUtf8Bytes } from "ethers";
import { HACKATHON_TREASURY_ABI, PRIZE_CLAIM_TOKEN_ABI } from "../../packages/shared/src/abi.js";
import {
  HEDERA_EVM_RPC,
  PRIZE_CLAIM_TOKEN_ADDRESS,
  TREASURY_CONTRACT_ADDRESS,
  TREASURY_RELAYER_PRIVATE_KEY,
} from "./config.js";

export const treasuryProvider = new JsonRpcProvider(HEDERA_EVM_RPC);
export const treasuryInterface = new Interface(HACKATHON_TREASURY_ABI);
export const prizeClaimInterface = new Interface(PRIZE_CLAIM_TOKEN_ABI);

export function getTreasuryReadContract(): Contract {
  if (!TREASURY_CONTRACT_ADDRESS) throw new Error("TREASURY_CONTRACT_ADDRESS is not configured");
  return new Contract(TREASURY_CONTRACT_ADDRESS, HACKATHON_TREASURY_ABI, treasuryProvider);
}

export function getTreasuryWriteContract(): Contract {
  if (!TREASURY_CONTRACT_ADDRESS) throw new Error("TREASURY_CONTRACT_ADDRESS is not configured");
  if (!TREASURY_RELAYER_PRIVATE_KEY) throw new Error("TREASURY_RELAYER_PRIVATE_KEY is not configured");
  const signer = new Wallet(TREASURY_RELAYER_PRIVATE_KEY, treasuryProvider);
  return new Contract(TREASURY_CONTRACT_ADDRESS, HACKATHON_TREASURY_ABI, signer);
}

export function getPrizeClaimReadContract(): Contract {
  if (!PRIZE_CLAIM_TOKEN_ADDRESS) throw new Error("PRIZE_CLAIM_TOKEN_ADDRESS is not configured");
  return new Contract(PRIZE_CLAIM_TOKEN_ADDRESS, PRIZE_CLAIM_TOKEN_ABI, treasuryProvider);
}

export function getPrizeClaimWriteContract(): Contract {
  if (!PRIZE_CLAIM_TOKEN_ADDRESS) throw new Error("PRIZE_CLAIM_TOKEN_ADDRESS is not configured");
  if (!TREASURY_RELAYER_PRIVATE_KEY) throw new Error("TREASURY_RELAYER_PRIVATE_KEY is not configured");
  const signer = new Wallet(TREASURY_RELAYER_PRIVATE_KEY, treasuryProvider);
  return new Contract(PRIZE_CLAIM_TOKEN_ADDRESS, PRIZE_CLAIM_TOKEN_ABI, signer);
}

export function hashRepo(githubUrl: string): `0x${string}` {
  return keccak256(toUtf8Bytes(githubUrl)) as `0x${string}`;
}
