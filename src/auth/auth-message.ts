export type WalletSource = "hashpack" | "metamask";
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
};

export function buildAuthSignedMessage(params: AuthChallenge & AuthenticatedUser): string {
  return [
    "EscrowSwap Pro sign-in",
    "",
    `Account: ${params.accountId}`,
    `Wallet: ${params.walletSource}`,
    `Network: ${params.network}`,
    `Challenge ID: ${params.challengeId}`,
    `Nonce: ${params.nonce}`,
    `Issued At: ${params.issuedAt}`,
    `Expires At: ${params.expiresAt}`,
    "",
    "Only sign this message if you are connecting to EscrowSwap Pro.",
  ].join("\n");
}
