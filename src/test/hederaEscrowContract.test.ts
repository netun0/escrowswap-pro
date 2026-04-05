import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Task } from "@/contracts/config";
import { approveTokenForEscrow } from "@/lib/hederaEscrowContract";

const mockSignerAddress = vi.fn<() => Promise<string>>();
const mockBalanceOf = vi.fn();
const mockAllowance = vi.fn();
const mockApproveStaticCall = vi.fn();
const mockApprove = vi.fn();

vi.mock("ethers", () => {
  class MockContract {
    address: string;
    abi: readonly string[];

    constructor(address: string, abi: readonly string[]) {
      this.address = address;
      this.abi = abi;
    }

    balanceOf(...args: unknown[]) {
      return mockBalanceOf(...args);
    }

    allowance(...args: unknown[]) {
      return mockAllowance(...args);
    }

    approve = Object.assign(
      (...args: unknown[]) => mockApprove(...args),
      {
        staticCall: (...args: unknown[]) => mockApproveStaticCall(...args),
      },
    );
  }

  class MockBrowserProvider {
    async getSigner() {
      return {
        getAddress: mockSignerAddress,
      };
    }
  }

  return {
    BrowserProvider: MockBrowserProvider,
    Contract: MockContract,
    Network: {
      from: vi.fn(() => ({ chainId: 296 })),
    },
    getAddress: (value: string) => value,
  };
});

function buildTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 7,
    client: "0.0.1234",
    worker: "0.0.2001",
    verifier: "0.0.2002",
    verifierMode: "human",
    specURI: "",
    outputURI: "",
    paymentToken: "0.0.429274",
    amount: 10_000n,
    workerPreferredToken: "0.0.429274",
    state: "Open",
    createdAt: 0,
    fundedAt: 0,
    submittedAt: 0,
    verifiedAt: 0,
    completedAt: 0,
    description: "test",
    deadline: 0,
    expiresAt: 0,
    maxBudget: 100,
    capabilities: [],
    escrowContract: true,
    clientEvm: "0xclient",
    workerEvm: "0xworker",
    verifierEvm: "0xverifier",
    tokenEvm: "0x000000000000000000000000000000000006f89a",
    ...overrides,
  };
}

describe("approveTokenForEscrow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const env = import.meta.env as ImportMetaEnv & Record<string, string>;
    env.VITE_ESCROW_CONTRACT_ADDRESS = "0x0000000000000000000000000000000000000abc";
    (globalThis as typeof globalThis & { ethereum?: object }).ethereum = {};
    mockSignerAddress.mockResolvedValue("0xclient");
  });

  it("fails early for injected-only wallets when the token is not associated", async () => {
    mockBalanceOf.mockRejectedValueOnce(new Error("TOKEN_NOT_ASSOCIATED_TO_ACCOUNT"));

    await expect(approveTokenForEscrow(buildTask(), { canExecuteNativeTransactions: false })).rejects.toThrow(
      /Sign in with HashPack to associate it in-app, or associate the token manually/i,
    );

    expect(mockApprove).not.toHaveBeenCalled();
  });

  it("uses native association when available and skips approve if allowance already covers the amount", async () => {
    const associateToken = vi.fn().mockResolvedValue({ transactionId: "0.0.1234@1.2" });
    mockBalanceOf
      .mockRejectedValueOnce(new Error("TOKEN_NOT_ASSOCIATED_TO_ACCOUNT"))
      .mockResolvedValueOnce(10_000n)
      .mockResolvedValueOnce(10_000n);
    mockAllowance.mockResolvedValue(10_000n);

    const result = await approveTokenForEscrow(buildTask(), {
      associateToken,
      canExecuteNativeTransactions: true,
    });

    expect(result).toBeNull();
    expect(associateToken).toHaveBeenCalledWith("0.0.1234", "0.0.429274");
    expect(mockApprove).not.toHaveBeenCalled();
  });

  it("skips native association when the token is already associated and still sends approve when allowance is low", async () => {
    const fakeTx = { wait: vi.fn() };
    const associateToken = vi.fn();
    mockBalanceOf.mockResolvedValue(20_000n);
    mockAllowance.mockResolvedValue(0n);
    mockApproveStaticCall.mockResolvedValue(true);
    mockApprove.mockResolvedValue(fakeTx);

    const result = await approveTokenForEscrow(buildTask(), {
      associateToken,
      canExecuteNativeTransactions: true,
    });

    expect(result).toBe(fakeTx);
    expect(associateToken).not.toHaveBeenCalled();
    expect(mockApprove).toHaveBeenCalledTimes(1);
  });
});
