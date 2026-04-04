/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ESCROW_USE_MOCK?: string;
  readonly VITE_HEDERA_API_URL?: string;
  /** Optional HTS token id (0.0.x) for a USDC-style demo token in the token picker */
  readonly VITE_HEDERA_USDC_TOKEN_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
