import { BrowserProvider, Contract, getAddress } from "ethers";
import { ensureHederaTestnetEvmChain, getInjectedEip1193 } from "@/lib/hederaEscrowContract";
import { HACKATHON_TREASURY_ABI, toOnchainId, type ApprovalRequest, type HackathonRecord } from "../../packages/shared/src/index";

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
] as const;

export async function getMetaMaskSigner() {
  const ethereum = getInjectedEip1193();
  if (!ethereum) {
    throw new Error("No injected MetaMask wallet was found.");
  }
  await ensureHederaTestnetEvmChain(ethereum);
  const provider = new BrowserProvider(ethereum);
  const signer = await provider.getSigner();
  return { provider, signer };
}

export async function approveTreasurySpending(params: {
  tokenAddress: string;
  treasuryAddress: string;
  amount: string;
}): Promise<string> {
  const { signer } = await getMetaMaskSigner();
  const token = new Contract(getAddress(params.tokenAddress), ERC20_ABI, signer);
  const tx = await token.approve(getAddress(params.treasuryAddress), BigInt(params.amount));
  const receipt = await tx.wait();
  return receipt?.hash ?? tx.hash;
}

export async function bootstrapHackathonTreasury(params: {
  treasuryAddress: string;
  hackathon: HackathonRecord;
}): Promise<string> {
  const { signer } = await getMetaMaskSigner();
  const contract = new Contract(getAddress(params.treasuryAddress), HACKATHON_TREASURY_ABI, signer);
  const tx = await contract.bootstrapHackathon(
    toOnchainId(params.hackathon.id),
    getAddress(params.hackathon.judgeEvmAddress),
    getAddress(params.hackathon.payoutTokenEvmAddress),
    BigInt(params.hackathon.autonomousThreshold),
    params.hackathon.tracks.map((track) => ({
      trackId: toOnchainId(track.id),
      budget: BigInt(track.prizeAmount),
    })),
  );
  const receipt = await tx.wait();
  return receipt?.hash ?? tx.hash;
}

export async function signApprovalRequest(approvalRequest: ApprovalRequest): Promise<string> {
  const { signer } = await getMetaMaskSigner();
  const typedData = approvalRequest.typedData as {
    domain: Record<string, unknown>;
    message: Record<string, unknown>;
    types: Record<string, Array<{ name: string; type: string }>>;
  };
  return signer.signTypedData(typedData.domain, typedData.types, typedData.message);
}
