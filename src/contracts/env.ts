/** On-chain mode when address is set and mock flag is off */
export const ESCROW_USE_MOCK =
  typeof import.meta.env.VITE_ESCROW_USE_MOCK === "string"
    ? import.meta.env.VITE_ESCROW_USE_MOCK !== "false"
    : true;

export const AGENT_ESCROW_ADDRESS = (import.meta.env.VITE_AGENT_ESCROW_ADDRESS as string | undefined)?.trim() ?? "";

/** When true, cross-token `verify` uses abi.encode(MockFakeOrder) for MockUniswapXReactor (local / deploy script mocks). */
export const UNISWAPX_USE_MOCK_ORDER =
  (import.meta.env.VITE_UNISWAPX_USE_MOCK_ORDER as string | undefined) !== "false";
