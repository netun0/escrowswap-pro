import type UniversalProvider from "@walletconnect/universal-provider";
import { createAppKit } from "@reown/appkit";
import {
  HederaAdapter,
  HederaChainDefinition,
  HederaProvider,
  hederaNamespace,
} from "@hashgraph/hedera-wallet-connect";
import type { ConnectedWalletInfo } from "@reown/appkit-controllers";
import { BrowserProvider, getAddress, type Eip1193Provider } from "ethers";

import type { HederaNetwork } from "@/auth/auth-message";

const PROJECT_ID = (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined)?.trim() ?? "";
const EIP155_NAMESPACE = "eip155";
const EIP155_TESTNET_CHAIN = `eip155:${HederaChainDefinition.EVM.Testnet.id}`;
const HEDERA_TESTNET_ACCOUNT_PREFIX = "hedera:testnet:";
const SUPPORTED_NAMESPACES = [hederaNamespace, EIP155_NAMESPACE] as const;

export const WALLET_CONNECT_CONFIGURED = PROJECT_ID.length > 0;

type WalletListener = (state: HederaWalletState) => void;

export type HederaWalletState = {
  accountId: string | null;
  evmAddress: string | null;
  signerAccountId: string | null;
  connected: boolean;
  network: HederaNetwork | null;
  walletName: string | null;
  walletType: string | null;
};

export type HederaWalletClient = {
  disconnect: () => Promise<void>;
  ensureConnected: (timeoutMs?: number) => Promise<HederaWalletState>;
  getEip1193Provider: () => Eip1193Provider;
  getState: () => HederaWalletState;
  openModal: () => Promise<void>;
  signEvmMessage: (message: string) => Promise<string>;
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
  return accounts.find((account) => account.startsWith(HEDERA_TESTNET_ACCOUNT_PREFIX)) ?? null;
}

function getEvmAddress(provider: HederaProvider): string | null {
  const accounts = provider.session?.namespaces?.[EIP155_NAMESPACE]?.accounts ?? [];
  const match = accounts.find((account) => account.startsWith(`${EIP155_TESTNET_CHAIN}:`));
  return match?.split(":")[2] ?? null;
}

function normalizeAccountId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  return /^\d+\.\d+\.\d+$/.test(trimmed) ? trimmed : null;
}

function normalizeEvmAddress(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    return getAddress(raw);
  } catch {
    return null;
  }
}

function buildWalletState(
  provider: HederaProvider,
  nativeAddress: string | null | undefined,
  eip155Address: string | null | undefined,
  walletInfo?: ConnectedWalletInfo,
): HederaWalletState {
  const signerAccountId = getSignerAccountId(provider);
  const parsedNative = parseSignerAccountId(signerAccountId);
  const accountId = normalizeAccountId(nativeAddress) ?? parsedNative.accountId;
  const evmAddress = normalizeEvmAddress(eip155Address) ?? normalizeEvmAddress(getEvmAddress(provider));
  const network = parsedNative.network ?? (accountId || evmAddress ? "testnet" : null);

  return {
    accountId,
    evmAddress,
    signerAccountId,
    connected: Boolean(accountId || evmAddress),
    network,
    walletName: typeof walletInfo?.name === "string" ? walletInfo.name : null,
    walletType: typeof walletInfo?.type === "string" ? walletInfo.type : null,
  };
}

function assertWalletConnectConfigured(): void {
  if (!WALLET_CONNECT_CONFIGURED) {
    throw new Error("Set VITE_WALLETCONNECT_PROJECT_ID to enable wallet sign-in.");
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
    throw new Error("Wallet sign-in is only available in the browser.");
  }

  const metadata = {
    name: "EscrowSwap Pro",
    description: "Hedera agent escrow wallet sign-in",
    url: window.location.origin,
    icons: [`${window.location.origin}/favicon.ico`],
  };

  const evmAdapter = new HederaAdapter({
    projectId: PROJECT_ID,
    namespace: EIP155_NAMESPACE,
    namespaceMode: "required",
    networks: [HederaChainDefinition.EVM.Testnet],
  });

  const nativeAdapter = new HederaAdapter({
    projectId: PROJECT_ID,
    namespace: hederaNamespace,
    namespaceMode: "optional",
    networks: [HederaChainDefinition.Native.Testnet],
  });

  const universalProvider = (await HederaProvider.init({
    projectId: PROJECT_ID,
    metadata,
  })) as unknown as UniversalProvider;

  const appKit = createAppKit({
    adapters: [evmAdapter, nativeAdapter],
    // @ts-expect-error upstream typings still lag universal provider support for Hedera
    universalProvider,
    projectId: PROJECT_ID,
    metadata,
    networks: [HederaChainDefinition.EVM.Testnet, HederaChainDefinition.Native.Testnet],
  });

  const provider = universalProvider as unknown as HederaProvider;
  let walletInfoByNamespace: Partial<Record<(typeof SUPPORTED_NAMESPACES)[number], ConnectedWalletInfo | undefined>> = {
    [hederaNamespace]: appKit.getWalletInfo(hederaNamespace),
    [EIP155_NAMESPACE]: appKit.getWalletInfo(EIP155_NAMESPACE),
  };
  const listeners = new Set<WalletListener>();
  const getActiveWalletInfo = () => walletInfoByNamespace[hederaNamespace] ?? walletInfoByNamespace[EIP155_NAMESPACE];
  const getActiveEip1193Provider = (): Eip1193Provider => {
    const injectedProvider = (evmAdapter as HederaAdapter & { activeInjectedProvider?: Eip1193Provider | null }).activeInjectedProvider;
    if (injectedProvider) {
      return injectedProvider;
    }
    const walletConnectProvider = evmAdapter.getWalletConnectProvider();
    if (!walletConnectProvider) {
      throw new Error("No Hedera EVM wallet is connected.");
    }
    walletConnectProvider.setDefaultChain(EIP155_TESTNET_CHAIN);
    return walletConnectProvider as unknown as Eip1193Provider;
  };
  const getState = () =>
    buildWalletState(
      provider,
      appKit.getAddress(hederaNamespace) ?? null,
      appKit.getAddress(EIP155_NAMESPACE) ?? null,
      getActiveWalletInfo(),
    );

  const notify = () => {
    const next = getState();
    listeners.forEach((listener) => listener(next));
  };

  SUPPORTED_NAMESPACES.forEach((namespace) => {
    appKit.subscribeAccount(() => {
      notify();
    }, namespace);
  });

  SUPPORTED_NAMESPACES.forEach((namespace) => {
    appKit.subscribeWalletInfo((nextInfo) => {
      walletInfoByNamespace = {
        ...walletInfoByNamespace,
        [namespace]: nextInfo,
      };
      notify();
    }, namespace);
  });

  appKit.subscribeCaipNetworkChange(() => {
    notify();
  });

  const waitForConnection = async (timeoutMs = 120_000): Promise<HederaWalletState> => {
    const current = getState();
    if (current.connected) {
      return current;
    }

    return new Promise<HederaWalletState>((resolve, reject) => {
      const startedAt = Date.now();
      let unsubscribeFns: Array<() => void> = [];
      unsubscribeFns = SUPPORTED_NAMESPACES.map((namespace) =>
        appKit.subscribeAccount(() => {
          const next = getState();
          if (next.connected) {
            unsubscribeFns.forEach((unsubscribe) => unsubscribe());
            resolve(next);
          } else if (Date.now() - startedAt >= timeoutMs) {
            unsubscribeFns.forEach((unsubscribe) => unsubscribe());
            reject(new Error("Wallet connection timed out. Open your wallet and try again."));
          }
        }, namespace),
      );

      const timer = window.setInterval(() => {
        const next = getState();
        if (next.connected) {
          window.clearInterval(timer);
          unsubscribeFns.forEach((unsubscribe) => unsubscribe());
          resolve(next);
        } else if (Date.now() - startedAt >= timeoutMs) {
          window.clearInterval(timer);
          unsubscribeFns.forEach((unsubscribe) => unsubscribe());
          reject(new Error("Wallet connection timed out. Open your wallet and try again."));
        }
      }, 500);
    });
  };

  return {
    disconnect: async () => {
      await appKit.disconnect();
      notify();
    },
    ensureConnected: async (timeoutMs?: number) => {
      const current = getState();
      if (!current.connected) {
        await appKit.open();
      }
      return waitForConnection(timeoutMs);
    },
    getEip1193Provider: () => {
      return getActiveEip1193Provider();
    },
    getState,
    openModal: async () => {
      await appKit.open();
    },
    signEvmMessage: async (message: string) => {
      const browserProvider = new BrowserProvider(getActiveEip1193Provider(), HederaChainDefinition.EVM.Testnet.id);
      const signer = await browserProvider.getSigner();
      return signer.signMessage(message);
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
