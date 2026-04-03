import { AbiCoder } from "ethers";

/**
 * Payload for `MockUniswapXReactor` in Hardhat tests (must match Solidity `FakeOrder` field order).
 * `swapper` must be the deployed `UniswapXPayout` contract address.
 */
export type MockUniswapXFakeOrder = {
  swapper: string;
  tokenIn: string;
  amountIn: bigint;
  tokenOut: string;
  recipient: string;
  amountOut: bigint;
};

export function encodeMockUniswapXOrder(order: MockUniswapXFakeOrder): `0x${string}` {
  const coder = AbiCoder.defaultAbiCoder();
  const tuple =
    "tuple(address swapper,address tokenIn,uint256 amountIn,address tokenOut,address recipient,uint256 amountOut)";
  return coder.encode([tuple], [order]) as `0x${string}`;
}
