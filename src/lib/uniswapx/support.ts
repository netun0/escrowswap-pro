import { CHAIN_CONFIG } from "@/contracts/config";

export const UNISWAPX_SUPPORTED_CHAIN_IDS = [1, 42161, 8453, 130] as const;

export function isUniswapXSupportedChain(chainId: number): boolean {
  return UNISWAPX_SUPPORTED_CHAIN_IDS.includes(chainId as (typeof UNISWAPX_SUPPORTED_CHAIN_IDS)[number]);
}

export function getEscrowSettlementSupportNote(): string {
  if (!isUniswapXSupportedChain(CHAIN_CONFIG.chainId)) {
    return `${CHAIN_CONFIG.chainName} (${CHAIN_CONFIG.chainId}) is not an official UniswapX settlement chain. Live payout settlement needs the escrow and payout contracts on Ethereum, Arbitrum, Base, or Unichain.`;
  }

  return `${CHAIN_CONFIG.chainName} supports UniswapX settlement. The remaining integration work belongs in the verifyWithUniswapXOrder path, where a fresh signed order is supplied at verification time.`;
}

export function getCreateTaskQuoteSupportNote(sourceChain: string, isCrossChain: boolean): string {
  if (!isCrossChain) {
    return getEscrowSettlementSupportNote();
  }

  return `This route ends on ${CHAIN_CONFIG.chainName}. The Trading API can quote a bridge or a same-chain swap, but not a combined bridge plus swap, and ${CHAIN_CONFIG.chainName} is not a supported UniswapX chain.`;
}
