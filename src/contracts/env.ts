/** When true or unset, the UI uses `src/contracts/mockData` and skips the Hedera API. */
export const ESCROW_USE_MOCK =
  typeof import.meta.env.VITE_ESCROW_USE_MOCK === "string"
    ? import.meta.env.VITE_ESCROW_USE_MOCK !== "false"
    : true;

/** Base URL for the Node Hedera escrow API (e.g. `http://localhost:3001`). */
export const HEDERA_API_URL = (import.meta.env.VITE_HEDERA_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";

const escrowAddr = (import.meta.env.VITE_ESCROW_CONTRACT_ADDRESS as string | undefined)?.trim() ?? "";

/** When set, new tasks must use an HTS ERC-20 (not HBAR) to match `HederaTaskEscrow`. */
export const ONCHAIN_ESCROW_ENABLED = escrowAddr.startsWith("0x") && escrowAddr.length >= 42;
