import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertCircle, Loader2, ShieldCheck, Wallet } from "lucide-react";
import { BrowserProvider, getAddress } from "ethers";
import { buildAuthSignedMessage, type AuthChallenge, type AuthenticatedUser, type HederaNetwork } from "@/auth/auth-message";
import { AuthContext } from "@/auth/context";
import type { AuthSession, AuthStatus, WalletConnection } from "@/auth/types";
import { resolveHederaAccountIdFromEvm } from "@/auth/resolveHederaAccount";
import { HEDERA_API_URL } from "@/contracts/env";
import { ensureHederaTestnetEvmChain, getInjectedEip1193 } from "@/lib/hederaEscrowContract";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type SessionResponse = {
  authenticated: boolean;
  user?: AuthenticatedUser;
};

const AUTH_NETWORK: HederaNetwork = "testnet";

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [wallet, setWallet] = useState<WalletConnection>({
    accountId: null,
    canExecuteNativeTransactions: false,
    connected: false,
    network: null,
    ready: false,
    walletName: null,
    walletSource: "metamask",
    walletType: null,
  });
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [authStatus, setAuthStatus] = useState<AuthStatus>("idle");
  const [authError, setAuthError] = useState<string | null>(null);

  const refreshSession = useCallback(async () => {
    if (!HEDERA_API_URL) return;
    const response = await fetch(`${HEDERA_API_URL}/auth/session`, { credentials: "include" });
    if (!response.ok) {
      throw new Error("Unable to refresh the current session.");
    }
    const payload = (await response.json()) as SessionResponse;
    const nextUser = payload.authenticated ? payload.user ?? null : null;
    setUser(nextUser);
    setWallet((prev) => ({
      ...prev,
      accountId: nextUser?.accountId ?? null,
      connected: Boolean(nextUser),
      network: nextUser?.network ?? null,
      ready: true,
      walletName: nextUser ? "MetaMask" : prev.walletName,
      walletSource: "metamask",
      walletType: nextUser ? "injected" : null,
    }));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await refreshSession();
      } catch (error) {
        if (!cancelled) setAuthError(readErrorMessage(error));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshSession]);

  const closeAuthDialog = useCallback(() => {
    setAuthDialogOpen(false);
    if (authStatus !== "connecting" && authStatus !== "awaiting_signature" && authStatus !== "verifying") {
      setAuthStatus("idle");
      setAuthError(null);
    }
  }, [authStatus]);

  const openAuthDialog = useCallback(() => {
    setAuthError(null);
    setAuthStatus("idle");
    setAuthDialogOpen(true);
  }, []);

  const signOut = useCallback(async () => {
    if (HEDERA_API_URL) {
      await fetch(`${HEDERA_API_URL}/auth/logout`, {
        credentials: "include",
        method: "POST",
      });
    }
    setUser(null);
    setAuthError(null);
    setAuthStatus("idle");
    setAuthDialogOpen(false);
    setWallet({
      accountId: null,
      canExecuteNativeTransactions: false,
      connected: false,
      network: null,
      ready: true,
      walletName: null,
      walletSource: "metamask",
      walletType: null,
    });
  }, []);

  const signInWithMetaMask = useCallback(async () => {
    try {
      if (!HEDERA_API_URL) {
        throw new Error("Set VITE_HEDERA_API_URL before using JudgeBuddy.");
      }
      setAuthError(null);
      setAuthStatus("connecting");

      const eth = getInjectedEip1193();
      if (!eth) {
        throw new Error("No injected wallet. Install MetaMask with a Ledger-backed Hedera Testnet account.");
      }

      await ensureHederaTestnetEvmChain(eth);
      const provider = new BrowserProvider(eth);
      const signer = await provider.getSigner();
      const evmAddress = getAddress(await signer.getAddress());
      const accountId = await resolveHederaAccountIdFromEvm(evmAddress);
      if (!accountId) {
        throw new Error("Could not map the connected MetaMask address to a Hedera account.");
      }

      setWallet({
        accountId,
        canExecuteNativeTransactions: false,
        connected: true,
        network: AUTH_NETWORK,
        ready: true,
        walletName: "MetaMask",
        walletSource: "metamask",
        walletType: "injected",
      });

      setAuthStatus("awaiting_signature");
      const nonceResponse = await fetch(`${HEDERA_API_URL}/auth/nonce`, {
        body: JSON.stringify({
          accountId,
          evmAddress,
          network: AUTH_NETWORK,
          walletSource: "metamask",
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
        evmAddress,
        network: AUTH_NETWORK,
        walletSource: "metamask",
      });
      const signature = await signer.signMessage(signedPayload);

      setAuthStatus("verifying");
      const verifyResponse = await fetch(`${HEDERA_API_URL}/auth/verify`, {
        body: JSON.stringify({
          accountId,
          challengeId: challenge.challengeId,
          evmAddress,
          network: AUTH_NETWORK,
          signature,
          signedPayload,
          walletSource: "metamask",
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
      associateToken: async () => {
        throw new Error("JudgeBuddy treasury does not use in-app HashPack token association.");
      },
      authDialogOpen,
      authError,
      authStatus,
      authenticated: Boolean(user),
      closeAuthDialog,
      loading,
      openAuthDialog,
      refreshSession,
      signIn: signInWithMetaMask,
      signInWithMetaMask,
      signOut,
      user,
      wallet,
    }),
    [authDialogOpen, authError, authStatus, closeAuthDialog, loading, openAuthDialog, refreshSession, signInWithMetaMask, signOut, user, wallet],
  );

  const dialogBusy = authStatus === "connecting" || authStatus === "awaiting_signature" || authStatus === "verifying";

  return (
    <AuthContext.Provider value={value}>
      {children}
      <Dialog
        open={authDialogOpen}
        onOpenChange={(open) => {
          if (open) setAuthDialogOpen(true);
          else closeAuthDialog();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Wallet className="h-4 w-4" />
              Sign in with MetaMask
            </DialogTitle>
            <DialogDescription>
              Connect the Hedera Testnet MetaMask account that holds the organizer, judge, or winner role. High-risk approvals must be signed by the configured Ledger-backed judge account inside MetaMask.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="rounded-md border border-border bg-muted/20 p-3 text-[11px] text-muted-foreground">
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono uppercase tracking-widest">Wallet</span>
                <span className="font-medium text-foreground">{wallet.walletName ?? "MetaMask"}</span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="font-mono uppercase tracking-widest">Account</span>
                <span className="font-mono text-foreground">{wallet.accountId ?? "Not connected"}</span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="font-mono uppercase tracking-widest">Network</span>
                <span className="font-medium text-foreground uppercase">{wallet.network ?? AUTH_NETWORK}</span>
              </div>
            </div>

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
                Confirm the one-time JudgeBuddy sign-in message in MetaMask.
              </div>
            )}

            {value.authenticated && value.user && (
              <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-[11px] text-muted-foreground">
                <div className="flex items-start gap-2">
                  <ShieldCheck className="mt-0.5 h-3.5 w-3.5 text-primary" />
                  <span>
                    Signed in as <span className="font-mono text-foreground">{value.user.accountId}</span> /{" "}
                    <span className="font-mono text-foreground">{value.user.evmAddress}</span>.
                  </span>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={closeAuthDialog}>
              Close
            </Button>
            <Button type="button" onClick={() => void signInWithMetaMask()} disabled={dialogBusy}>
              {dialogBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wallet className="mr-2 h-4 w-4" />}
              {authStatus === "awaiting_signature" ? "Awaiting signature" : authStatus === "verifying" ? "Verifying" : "Connect MetaMask"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AuthContext.Provider>
  );
}
