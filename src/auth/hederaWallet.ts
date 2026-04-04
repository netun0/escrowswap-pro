import type UniversalProvider from "@walletconnect/universal-provider";
import { createAppKit } from "@reown/appkit";
import {
  HederaAdapter,
  HederaChainDefinition,
  HederaProvider,
  hederaNamespace,
} from "@hashgraph/hedera-wallet-connect";
import type { ConnectedWalletInfo } from "@reown/appkit-controllers";

import type { HederaNetwork } from "@/auth/auth-message";

const PROJECT_ID = (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined)?.trim() ?? "";

export const WALLET_CONNECT_CONFIGURED = PROJECT_ID.length > 0;

type WalletListener = (state: HederaWalletState) => void;

export type HederaWalletState = {
  accountId: string | null;
  signerAccountId: string | null;
  connected: boolean;
  network: HederaNetwork | null;
  walletName: string | null;
  walletType: string | null;
};

export type HederaWalletClient = {
  disconnect: () => Promise<void>;
  ensureConnected: (timeoutMs?: number) => Promise<HederaWalletState>;
  getState: () => HederaWalletState;
  openModal: () => Promise<void>;
  signMessage: (message: string) => Promise<string>;
  subscribe: (listener: WalletListener) => () => void;
};

let walletClientPromise: Promise<HederaWalletClient> | null = null;

function parseSignerAccountId(signerAccountId: string | null): Pick<HederaWalletState, "accountId" | "network"> {
  if (!signerAccountId) {
    return { accountId: null, network: null };
  }

  const [namespace, network, accountId] = signerAccountId.split(":");
  if (namespace !== "hedera" || !accountId) {
    return { accountId: null, network: null };
  }

  if (network !== "testnet") {
    return { accountId: null, network: null };
  }

  return { accountId, network };
}

function getSignerAccountId(provider: HederaProvider): string | null {
  const accounts = provider.session?.namespaces?.hedera?.accounts ?? [];
  return accounts.find((account) => account.startsWith("hedera:testnet:")) ?? null;
}

function buildWalletState(provider: HederaProvider, walletInfo?: ConnectedWalletInfo): HederaWalletState {
  const signerAccountId = getSignerAccountId(provider);
  const { accountId, network } = parseSignerAccountId(signerAccountId);

  return {
    accountId,
    signerAccountId,
    connected: Boolean(accountId && network),
    network,
    walletName: typeof walletInfo?.name === "string" ? walletInfo.name : null,
    walletType: typeof walletInfo?.type === "string" ? walletInfo.type : null,
  };
}

function assertWalletConnectConfigured(): void {
  if (!WALLET_CONNECT_CONFIGURED) {
    throw new Error("Set VITE_WALLETCONNECT_PROJECT_ID to enable HashPack sign-in.");
  }
}

export async function ensureHederaWalletClient(): Promise<HederaWalletClient> {
  assertWalletConnectConfigured();

  if (!walletClientPromise) {
    walletClientPromise = createWalletClient();
  }

  return walletClientPromise;
}

async function createWalletClient(): Promise<HederaWalletClient> {
  if (typeof window === "undefined") {
    throw new Error("HashPack sign-in is only available in the browser.");
  }

  const metadata = {
    name: "EscrowSwap Pro",
    description: "Hedera agent escrow with HashPack sign-in",
    url: window.location.origin,
    icons: [`${window.location.origin}/favicon.ico`],
  };

  const nativeAdapter = new HederaAdapter({
    projectId: PROJECT_ID,
    namespace: hederaNamespace,
    namespaceMode: "required",
    networks: [HederaChainDefinition.Native.Testnet],
  });

  const universalProvider = (await HederaProvider.init({
    projectId: PROJECT_ID,
    metadata,
  })) as unknown as UniversalProvider;

  const appKit = createAppKit({
    adapters: [nativeAdapter],
    // @ts-expect-error upstream typings still lag universal provider support for Hedera
    universalProvider,
    projectId: PROJECT_ID,
    metadata,
    networks: [HederaChainDefinition.Native.Testnet],
  });

  const provider = universalProvider as unknown as HederaProvider;
  let walletInfo = appKit.getWalletInfo(hederaNamespace);
  const listeners = new Set<WalletListener>();

  const notify = () => {
    const next = buildWalletState(provider, walletInfo);
    listeners.forEach((listener) => listener(next));
  };

  appKit.subscribeAccount(() => {
    notify();
  }, hederaNamespace);

  appKit.subscribeWalletInfo((nextInfo) => {
    walletInfo = nextInfo;
    notify();
  }, hederaNamespace);

  appKit.subscribeCaipNetworkChange(() => {
    notify();
  });

  const getState = () => buildWalletState(provider, walletInfo);

  const waitForConnection = async (timeoutMs = 120_000): Promise<HederaWalletState> => {
    const current = getState();
    if (current.connected) {
      return current;
    }

    return new Promise<HederaWalletState>((resolve, reject) => {
      const startedAt = Date.now();
      const unsubscribe = appKit.subscribeAccount(() => {
        const next = getState();
        if (next.connected) {
          unsubscribe();
          resolve(next);
        } else if (Date.now() - startedAt >= timeoutMs) {
          unsubscribe();
          reject(new Error("Wallet connection timed out. Open HashPack and try again."));
        }
      }, hederaNamespace);

      const timer = window.setInterval(() => {
        const next = getState();
        if (next.connected) {
          window.clearInterval(timer);
          unsubscribe();
          resolve(next);
        } else if (Date.now() - startedAt >= timeoutMs) {
          window.clearInterval(timer);
          unsubscribe();
          reject(new Error("Wallet connection timed out. Open HashPack and try again."));
        }
      }, 500);
    });
  };

  return {
    disconnect: async () => {
      await appKit.disconnect(hederaNamespace);
      notify();
    },
    ensureConnected: async (timeoutMs?: number) => {
      const current = getState();
      if (!current.connected) {
        await appKit.open();
      }
      return waitForConnection(timeoutMs);
    },
    getState,
    openModal: async () => {
      await appKit.open();
    },
    signMessage: async (message: string) => {
      const signerAccountId = getSignerAccountId(provider);
      if (!signerAccountId) {
        throw new Error("Connect HashPack before signing a message.");
      }

      const result = await provider.hedera_signMessage({
        signerAccountId,
        message,
      });

      return result.signatureMap;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      listener(getState());
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
