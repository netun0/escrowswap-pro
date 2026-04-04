/** When true or unset, the UI uses `src/contracts/mockData` and skips the Hedera API. */
export const ESCROW_USE_MOCK =
  typeof import.meta.env.VITE_ESCROW_USE_MOCK === "string"
    ? import.meta.env.VITE_ESCROW_USE_MOCK !== "false"
    : true;

/** Base URL for the Node Hedera escrow API (e.g. `http://localhost:3001`). */
export const HEDERA_API_URL = (import.meta.env.VITE_HEDERA_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";
