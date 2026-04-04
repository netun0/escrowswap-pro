import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertCircle, Loader2, ShieldCheck, Wallet } from "lucide-react";
import { BrowserProvider, getAddress } from "ethers";

import {
  buildAuthSignedMessage,
  type AuthChallenge,
  type AuthenticatedUser,
  type HederaNetwork,
  type WalletSource,
} from "@/auth/auth-message";
import { AuthContext } from "@/auth/context";
import type { HederaWalletClient, HederaWalletState } from "@/auth/hederaWallet";
import type { AuthSession, AuthStatus, WalletConnection } from "@/auth/types";
import { resolveHederaAccountIdFromEvm } from "@/auth/resolveHederaAccount";
import { ESCROW_USE_MOCK, HEDERA_API_URL } from "@/contracts/env";
import { ensureHederaTestnetEvmChain, getInjectedEip1193 } from "@/lib/hederaEscrowContract";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type SessionResponse = {
  authenticated: boolean;
  user?: AuthenticatedUser;
};

const AUTH_NETWORK: HederaNetwork = "testnet";
const HASHPACK_SOURCE: WalletSource = "hashpack";
const METAMASK_SOURCE: WalletSource = "metamask";
const WALLET_CONNECT_CONFIGURED = Boolean((import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined)?.trim());

function toWalletConnection(state: HederaWalletState | null, ready: boolean, sessionUser: AuthenticatedUser | null): WalletConnection {
  const walletSource: WalletSource =
    sessionUser?.walletSource ?? (state?.walletName === "MetaMask" ? METAMASK_SOURCE : HASHPACK_SOURCE);
  return {
    accountId: state?.accountId ?? sessionUser?.accountId ?? null,
    connected: state?.connected ?? Boolean(sessionUser),
    network: state?.network ?? sessionUser?.network ?? null,
    ready,
    walletName: state?.walletName ?? (sessionUser?.walletSource === METAMASK_SOURCE ? "MetaMask" : null),
    walletSource,
    walletType: state?.walletType ?? null,
  };
}

function assertHashPackWallet(state: HederaWalletState): void {
  if (state.walletName && state.walletName.toLowerCase() !== "hashpack") {
    throw new Error(`HashPack is required for v1. Connected wallet: ${state.walletName}.`);
  }

  if (!state.accountId) {
    throw new Error("HashPack did not provide a Hedera account id.");
  }

  if (state.network !== AUTH_NETWORK) {
    throw new Error("HashPack must be connected to Hedera Testnet.");
  }
}

function buildLocalUser(state: HederaWalletState): AuthenticatedUser {
  if (!state.accountId || state.network !== AUTH_NETWORK) {
    throw new Error("Connect a Hedera Testnet account in HashPack first.");
  }

  return {
    accountId: state.accountId,
    walletSource: HASHPACK_SOURCE,
    network: AUTH_NETWORK,
  };
}

function buildLocalMetaMaskUser(accountId: string): AuthenticatedUser {
  return {
    accountId,
    walletSource: METAMASK_SOURCE,
    network: AUTH_NETWORK,
  };
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function loadWalletClient(): Promise<HederaWalletClient> {
  const module = await import("@/auth/hederaWallet");
  return module.ensureHederaWalletClient();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const clientRef = useRef<HederaWalletClient | null>(null);
  const [loading, setLoading] = useState(true);
  const [walletReady, setWalletReady] = useState(false);
  const [walletState, setWalletState] = useState<HederaWalletState | null>(null);
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [authStatus, setAuthStatus] = useState<AuthStatus>("idle");
  const [authError, setAuthError] = useState<string | null>(null);

  const refreshSession = useCallback(async () => {
    if (!HEDERA_API_URL || ESCROW_USE_MOCK) {
      return;
    }

    const response = await fetch(`${HEDERA_API_URL}/auth/session`, {
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error("Unable to refresh the current session.");
    }

    const payload = (await response.json()) as SessionResponse;
    const nextUser = payload.authenticated ? payload.user ?? null : null;
    setUser(nextUser);
    if (nextUser?.walletSource === METAMASK_SOURCE && nextUser.accountId) {
      setWalletState({
        accountId: nextUser.accountId,
        signerAccountId: null,
        connected: true,
        network: AUTH_NETWORK,
        walletName: "MetaMask",
        walletType: "injected",
      });
      setWalletReady(true);
    } else if (!nextUser) {
      setWalletState((prev) => (prev?.walletName === "MetaMask" ? null : prev));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    const boot = async () => {
      try {
        if (WALLET_CONNECT_CONFIGURED) {
          const client = await loadWalletClient();
          if (cancelled) return;
          clientRef.current = client;
          setWalletState(client.getState());
          setWalletReady(true);
          unsubscribe = client.subscribe((next) => {
            if (!cancelled) {
              setWalletState(next);
            }
          });
        }

        await refreshSession();
      } catch (error) {
        if (!cancelled) {
          setAuthError(readErrorMessage(error));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void boot();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [refreshSession]);

  const closeAuthDialog = useCallback(() => {
    setAuthDialogOpen(false);
    if (authStatus !== "verifying" && authStatus !== "awaiting_signature") {
      setAuthStatus("idle");
      setAuthError(null);
    }
  }, [authStatus]);

  const openAuthDialog = useCallback(() => {
    setAuthDialogOpen(true);
    setAuthError(null);
    setAuthStatus("idle");
  }, []);

  const signOut = useCallback(async () => {
    const signingOut = user;
    try {
      if (HEDERA_API_URL && !ESCROW_USE_MOCK) {
        await fetch(`${HEDERA_API_URL}/auth/logout`, {
          credentials: "include",
          method: "POST",
        });
      }
    } finally {
      setUser(null);
      setAuthError(null);
      setAuthStatus("idle");
      setAuthDialogOpen(false);
      if (signingOut?.walletSource === METAMASK_SOURCE) {
        setWalletState(null);
      } else {
        await clientRef.current?.disconnect().catch(() => undefined);
        setWalletState(clientRef.current?.getState() ?? null);
      }
    }
  }, [user]);

  useEffect(() => {
    if (!user || !walletState?.accountId || !walletState.connected) {
      return;
    }

    if (walletState.accountId !== user.accountId) {
      void signOut();
    }
  }, [signOut, user, walletState]);

  const signIn = useCallback(async () => {
    try {
      setAuthError(null);
      setAuthStatus("connecting");

      const client = await loadWalletClient();
      clientRef.current = client;

      const connectedWallet = await client.ensureConnected();
      assertHashPackWallet(connectedWallet);
      setWalletReady(true);
      setWalletState(connectedWallet);

      if (!HEDERA_API_URL || ESCROW_USE_MOCK) {
        setUser(buildLocalUser(connectedWallet));
        setAuthStatus("idle");
        setAuthDialogOpen(false);
        return;
      }

      setAuthStatus("awaiting_signature");
      const nonceResponse = await fetch(`${HEDERA_API_URL}/auth/nonce`, {
        body: JSON.stringify({
          accountId: connectedWallet.accountId,
          walletSource: HASHPACK_SOURCE,
          network: AUTH_NETWORK,
        }),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      if (!nonceResponse.ok) {
        throw new Error(await nonceResponse.text());
      }

      const challenge = (await nonceResponse.json()) as AuthChallenge;
      const signedPayload = buildAuthSignedMessage({
        ...challenge,
        accountId: connectedWallet.accountId!,
        walletSource: HASHPACK_SOURCE,
        network: AUTH_NETWORK,
      });

      const signature = await client.signMessage(signedPayload);

      setAuthStatus("verifying");
      const verifyResponse = await fetch(`${HEDERA_API_URL}/auth/verify`, {
        body: JSON.stringify({
          accountId: connectedWallet.accountId,
          challengeId: challenge.challengeId,
          network: AUTH_NETWORK,
          signature,
          signedPayload,
          walletSource: HASHPACK_SOURCE,
        }),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      if (!verifyResponse.ok) {
        throw new Error(await verifyResponse.text());
      }

      const payload = (await verifyResponse.json()) as { user: AuthenticatedUser };
      setUser(payload.user);
      setAuthStatus("idle");
      setAuthDialogOpen(false);
    } catch (error) {
      setAuthStatus("error");
      setAuthError(readErrorMessage(error));
      throw error;
    }
  }, []);

  const signInWithMetaMask = useCallback(async () => {
    try {
      setAuthError(null);
      setAuthStatus("connecting");
      const eth = getInjectedEip1193();
      if (!eth) {
        throw new Error("No injected wallet. Install MetaMask (or another EVM wallet with Hedera Testnet).");
      }
      await ensureHederaTestnetEvmChain(eth);
      const provider = new BrowserProvider(eth);
      const signer = await provider.getSigner();
      const evm = getAddress(await signer.getAddress());
      const accountId = await resolveHederaAccountIdFromEvm(evm);
      if (!accountId) {
        throw new Error(
          "Could not map this EVM address to a Hedera account. Use an ECDSA account with an EVM alias (mirror evm_address).",
        );
      }

      setWalletReady(true);
      setWalletState({
        accountId,
        signerAccountId: null,
        connected: true,
        network: AUTH_NETWORK,
        walletName: "MetaMask",
        walletType: "injected",
      });

      if (!HEDERA_API_URL || ESCROW_USE_MOCK) {
        setUser(buildLocalMetaMaskUser(accountId));
        setAuthStatus("idle");
        setAuthDialogOpen(false);
        return;
      }

      setAuthStatus("awaiting_signature");
      const nonceResponse = await fetch(`${HEDERA_API_URL}/auth/nonce`, {
        body: JSON.stringify({
          accountId,
          walletSource: METAMASK_SOURCE,
          network: AUTH_NETWORK,
        }),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      if (!nonceResponse.ok) {
        throw new Error(await nonceResponse.text());
      }

      const challenge = (await nonceResponse.json()) as AuthChallenge;
      const signedPayload = buildAuthSignedMessage({
        ...challenge,
        accountId,
        walletSource: METAMASK_SOURCE,
        network: AUTH_NETWORK,
      });
      const signature = await signer.signMessage(signedPayload);

      setAuthStatus("verifying");
      const verifyResponse = await fetch(`${HEDERA_API_URL}/auth/verify`, {
        body: JSON.stringify({
          accountId,
          challengeId: challenge.challengeId,
          network: AUTH_NETWORK,
          signature,
          signedPayload,
          walletSource: METAMASK_SOURCE,
        }),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      if (!verifyResponse.ok) {
        throw new Error(await verifyResponse.text());
      }

      const payload = (await verifyResponse.json()) as { user: AuthenticatedUser };
      setUser(payload.user);
      setAuthStatus("idle");
      setAuthDialogOpen(false);
    } catch (error) {
      setAuthStatus("error");
      setAuthError(readErrorMessage(error));
      throw error;
    }
  }, []);

  const value = useMemo<AuthSession>(
    () => ({
      authDialogOpen,
      authError,
      authStatus,
      authenticated: Boolean(user),
      closeAuthDialog,
      loading,
      openAuthDialog,
      refreshSession,
      signIn,
      signInWithMetaMask,
      signOut,
      user,
      wallet: toWalletConnection(walletState, walletReady, user),
    }),
    [
      authDialogOpen,
      authError,
      authStatus,
      closeAuthDialog,
      loading,
      openAuthDialog,
      refreshSession,
      signIn,
      signInWithMetaMask,
      signOut,
      user,
      walletReady,
      walletState,
    ],
  );

  const dialogBusy = authStatus === "connecting" || authStatus === "awaiting_signature" || authStatus === "verifying";

  return (
    <AuthContext.Provider value={value}>
      {children}

      <Dialog
        open={authDialogOpen}
        onOpenChange={(open) => {
          if (open) {
            setAuthDialogOpen(true);
          } else {
            closeAuthDialog();
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Wallet className="h-4 w-4" />
              Sign in
            </DialogTitle>
            <DialogDescription>
              Choose <strong>MetaMask</strong> (injected EVM on Hedera chain 296) or <strong>HashPack</strong> via WalletConnect. You
              will sign a one-time message to open a session with the API.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="rounded-md border border-border bg-muted/20 p-3 text-[11px] text-muted-foreground">
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono uppercase tracking-widest">Wallet</span>
                <span className="font-medium text-foreground">
                  {value.wallet.walletName ?? (value.wallet.connected ? "Connected" : "—")}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="font-mono uppercase tracking-widest">Account</span>
                <span className="font-mono text-foreground">
                  {value.wallet.accountId ?? "Not connected"}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="font-mono uppercase tracking-widest">Network</span>
                <span className="font-medium text-foreground uppercase">
                  {value.wallet.network ?? AUTH_NETWORK}
                </span>
              </div>
            </div>

            {!WALLET_CONNECT_CONFIGURED && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-[11px] text-amber-700">
                <code className="font-mono text-foreground">VITE_WALLETCONNECT_PROJECT_ID</code> is not set — HashPack sign-in is
                disabled. Use <strong>MetaMask</strong> or add a Reown project id.
              </div>
            )}

            {authError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-[11px] text-destructive">
                <div className="flex items-start gap-2">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{authError}</span>
                </div>
              </div>
            )}

            {authStatus === "awaiting_signature" && (
              <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-[11px] text-muted-foreground">
                Approve the sign-in message in your wallet (MetaMask or HashPack) to finish authentication.
              </div>
            )}

            {value.authenticated && value.user && (
              <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-[11px] text-muted-foreground">
                <div className="flex items-start gap-2">
                  <ShieldCheck className="mt-0.5 h-3.5 w-3.5 text-primary" />
                  <span>
                    Signed in as <span className="font-mono text-foreground">{value.user.accountId}</span>.
                  </span>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={closeAuthDialog}>
              Close
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="font-mono text-xs"
              onClick={() => void signInWithMetaMask()}
              disabled={dialogBusy}
            >
              {dialogBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Sign in with MetaMask
            </Button>
            <Button type="button" onClick={() => void signIn()} disabled={dialogBusy || !WALLET_CONNECT_CONFIGURED}>
              {dialogBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wallet className="mr-2 h-4 w-4" />}
              {authStatus === "awaiting_signature"
                ? "Awaiting signature"
                : authStatus === "verifying"
                  ? "Verifying"
                  : "Sign in with HashPack"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AuthContext.Provider>
  );
}
