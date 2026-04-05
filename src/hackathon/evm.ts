import { BrowserProvider, Contract, getAddress } from "ethers";
import { HACKATHON_TREASURY_ABI } from "@shared/abi";
import { toOnchainId } from "@shared/ids";
import { buildAwardApprovalTypedData, type ApprovalRequest, type ApproveAwardRequest, type AwardProposal, type HackathonRecord } from "@shared/treasury";
import { ensureHederaTestnetEvmChain, getInjectedEip1193 } from "@/lib/hederaEscrowContract";
import { TREASURY_BROWSER_CONTRACT_ADDRESS } from "@/hackathon/api";

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
] as const;

function requireTreasuryAddress(): string {
  if (!TREASURY_BROWSER_CONTRACT_ADDRESS.startsWith("0x")) {
    throw new Error("Set VITE_TREASURY_CONTRACT_ADDRESS to enable direct treasury transactions from the browser.");
  }
  return TREASURY_BROWSER_CONTRACT_ADDRESS;
}

async function getMetaMaskProvider(): Promise<BrowserProvider> {
  const ethereum = getInjectedEip1193();
  if (!ethereum) {
    throw new Error("No MetaMask-compatible injected wallet was found.");
  }
  await ensureHederaTestnetEvmChain(ethereum);
  return new BrowserProvider(ethereum);
}

async function getSignerAddress(): Promise<string> {
  const provider = await getMetaMaskProvider();
  const signer = await provider.getSigner();
  return getAddress(await signer.getAddress());
}

export async function readTreasuryAllowance(tokenAddress: string): Promise<bigint> {
  const provider = await getMetaMaskProvider();
  const owner = await getSignerAddress();
  const token = new Contract(tokenAddress, ERC20_ABI, provider);
  return (await token.allowance(owner, requireTreasuryAddress())) as bigint;
}

export async function approveTreasuryFunding(tokenAddress: string, amount: string): Promise<string> {
  const provider = await getMetaMaskProvider();
  const signer = await provider.getSigner();
  const token = new Contract(tokenAddress, ERC20_ABI, signer);
  const tx = await token.approve(requireTreasuryAddress(), amount);
  const receipt = await tx.wait();
  return receipt?.hash ?? tx.hash;
}

export async function bootstrapHackathonTreasury(hackathon: HackathonRecord): Promise<string> {
  const provider = await getMetaMaskProvider();
  const signer = await provider.getSigner();
  const treasury = new Contract(requireTreasuryAddress(), HACKATHON_TREASURY_ABI, signer);
  const tx = await treasury.bootstrapHackathon(
    toOnchainId(hackathon.id),
    hackathon.judgeEvmAddress,
    hackathon.payoutTokenEvmAddress,
    hackathon.autonomousThreshold,
    hackathon.tracks.map((track) => ({
      trackId: toOnchainId(track.id),
      budget: track.prizeAmount,
    })),
  );
  const receipt = await tx.wait();
  return receipt?.hash ?? tx.hash;
}

export async function signAwardApproval(
  hackathon: HackathonRecord,
  award: AwardProposal,
  approvalRequest: ApprovalRequest,
): Promise<ApproveAwardRequest> {
  const provider = await getMetaMaskProvider();
  const signer = await provider.getSigner();
  const signerAddress = getAddress(await signer.getAddress());
  if (getAddress(approvalRequest.signerEvmAddress) !== signerAddress) {
    throw new Error(`Connect the configured judge signer ${approvalRequest.signerEvmAddress} in MetaMask before approving.`);
  }

  const approval = {
    awardId: award.id,
    hackathonId: award.hackathonId,
    submissionId: award.submissionId,
    trackId: award.trackId,
    winner: award.winnerEvmAddress,
    amount: award.amount,
    settlementMode: award.settlementMode,
    expiresAt: Math.floor(new Date(approvalRequest.expiresAt).getTime() / 1000),
  } satisfies ApproveAwardRequest["approval"];

  const typedData = buildAwardApprovalTypedData({
    chainId: 296,
    verifyingContract: requireTreasuryAddress(),
    approval: {
      awardId: toOnchainId(award.id),
      hackathonId: toOnchainId(hackathon.id),
      submissionId: toOnchainId(award.submissionId),
      trackId: toOnchainId(award.trackId),
      winner: award.winnerEvmAddress,
      amount: award.amount,
      settlementMode: award.settlementMode,
      expiresAt: approval.expiresAt,
    },
  });

  const signature = await signer.signTypedData(typedData.domain, typedData.types, typedData.value);
  return { approval, signature };
}
