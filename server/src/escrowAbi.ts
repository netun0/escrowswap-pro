/** Minimal ABI for HederaTaskEscrow (server read + types only; txs are wallet-signed in the browser). */
export const HEDERA_TASK_ESCROW_ABI = [
  "function tasks(uint256 taskId) view returns (address client, address worker, address verifier, address token, uint256 amount, uint8 status)",
] as const;

/** Matches `enum Status` in HederaTaskEscrow.sol */
export const EscrowOnChainStatus = {
  None: 0,
  Funded: 1,
  Released: 2,
  Refunded: 3,
} as const;
