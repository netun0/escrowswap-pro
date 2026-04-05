import { config as loadEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

loadEnv({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../.env") });

export const PORT = Number(process.env.PORT || 3001);
export const DATABASE_URL =
  process.env.DATABASE_URL?.trim() || "postgres://postgres:postgres@127.0.0.1:5432/judgebuddy";
export const NETWORK = (process.env.HEDERA_NETWORK || "testnet").toLowerCase();
export const MIRROR_BASE =
  (
    process.env.HEDERA_MIRROR_BASE ||
    (NETWORK === "mainnet" ? "https://mainnet.mirrornode.hedera.com" : "https://testnet.mirrornode.hedera.com")
  )
    .trim()
    .replace(/\/$/, "");
export const HEDERA_EVM_RPC =
  (
    process.env.HEDERA_EVM_RPC ||
    (NETWORK === "mainnet" ? "https://mainnet.hashio.io/api" : "https://testnet.hashio.io/api")
  )
    .trim()
    .replace(/\/$/, "");
export const HCS_TOPIC_ID = process.env.HCS_TOPIC_ID?.trim() || "";
export const HEDERA_ACCOUNT_ID = process.env.HEDERA_ACCOUNT_ID?.trim() || "";
export const HEDERA_PRIVATE_KEY = process.env.HEDERA_PRIVATE_KEY?.trim() || "";
export const TREASURY_CONTRACT_ADDRESS = process.env.TREASURY_CONTRACT_ADDRESS?.trim() || "";
export const PRIZE_CLAIM_TOKEN_ADDRESS = process.env.PRIZE_CLAIM_TOKEN_ADDRESS?.trim() || "";
export const TREASURY_RELAYER_PRIVATE_KEY = process.env.TREASURY_RELAYER_PRIVATE_KEY?.trim() || "";
export const TREASURY_AGENT_RELAYER = process.env.TREASURY_AGENT_RELAYER?.trim() || "";
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim() || "";
export const OPENAI_MODEL = process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini";
export const WORKER_POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS || 3000);
export const SESSION_COOKIE_NAME = "judgebuddy_session";
