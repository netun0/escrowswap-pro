/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ESCROW_USE_MOCK?: string;
  readonly VITE_HEDERA_API_URL?: string;
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string;
  /** Optional HTS token id (0.0.x) for a USDC-style demo token in the token picker */
  readonly VITE_HEDERA_USDC_TOKEN_ID?: string;
  /** Optional: operator account id shown so funders know where to send HBAR/HTS */
  readonly VITE_HEDERA_OPERATOR_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
