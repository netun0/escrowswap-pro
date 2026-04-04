import type { AuthenticatedUser, HederaNetwork, WalletSource } from "@/auth/auth-message";

export type WalletConnection = {
  accountId: string | null;
  connected: boolean;
  evmAddress: string | null;
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
  authenticated: boolean;
  closeAuthDialog: () => void;
  loading: boolean;
  openAuthDialog: () => void;
  refreshSession: () => Promise<void>;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  user: AuthenticatedUser | null;
  wallet: WalletConnection;
};
