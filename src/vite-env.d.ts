/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ESCROW_USE_MOCK?: string;
  readonly VITE_AGENT_ESCROW_ADDRESS?: string;
  readonly VITE_UNISWAPX_USE_MOCK_ORDER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
