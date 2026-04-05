import type { AuthenticatedUser, HederaNetwork, WalletSource } from "@/auth/auth-message";

export type NativeAssociationResult = {
  transactionId: string;
};

export type WalletConnection = {
  accountId: string | null;
  canExecuteNativeTransactions: boolean;
  connected: boolean;
  network: HederaNetwork | null;
  ready: boolean;
  walletName: string | null;
  walletSource: WalletSource;
  walletType: string | null;
};

export type AuthStatus = "idle" | "connecting" | "awaiting_signature" | "verifying" | "error";

export type AuthSession = {
  authDialogOpen: boolean;
  authError: string | null;
  authStatus: AuthStatus;
  associateToken: (accountId: string, tokenId: string) => Promise<NativeAssociationResult>;
  authenticated: boolean;
  closeAuthDialog: () => void;
  loading: boolean;
  openAuthDialog: () => void;
  refreshSession: () => Promise<void>;
  signIn: () => Promise<void>;
  signInWithMetaMask: () => Promise<void>;
  signOut: () => Promise<void>;
  user: AuthenticatedUser | null;
  wallet: WalletConnection;
};
