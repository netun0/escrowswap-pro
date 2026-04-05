export type WalletSource = "metamask";
export type HederaNetwork = "testnet";

export type AuthChallenge = {
  challengeId: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
};

export type AuthenticatedUser = {
  accountId: string;
  walletSource: WalletSource;
  network: HederaNetwork;
  evmAddress: string;
};

export function buildAuthSignedMessage(params: AuthChallenge & AuthenticatedUser): string {
  return [
    "JudgeBuddy treasury sign-in",
    "",
    `Account: ${params.accountId}`,
    `Wallet: ${params.walletSource}`,
    `Network: ${params.network}`,
    `EVM Address: ${params.evmAddress}`,
    `Challenge ID: ${params.challengeId}`,
    `Nonce: ${params.nonce}`,
    `Issued At: ${params.issuedAt}`,
    `Expires At: ${params.expiresAt}`,
    "",
    "Only sign this message if you are connecting to JudgeBuddy.",
  ].join("\n");
}
