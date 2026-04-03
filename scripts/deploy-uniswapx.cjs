/**
 * Deploy UniswapXPayout + AgentEscrow for a network.
 *
 * Env:
 *   DEPLOYER_PRIVATE_KEY — required on live networks
 *   SEPOLIA_RPC_URL — optional (default public Sepolia RPC)
 *
 * Addresses (documented by Uniswap; verify on https://docs.uniswap.org/contracts/uniswapx/deployment):
 *   Permit2 Ethereum mainnet: 0x000000000022D473030F116dDEE9F6B43aC78BA3
 *   V2 Dutch Order Reactor mainnet: 0x00000011f84b9aa48e5f8aa8b9897600006289be
 *
 * Sepolia: UniswapX reactor is not listed in official deployment tables — use a custom reactor
 * or fork mainnet for integration tests. For Sepolia smoke tests, deploy mocks from hardhat fixtures.
 */

const hre = require("hardhat");

const MAINNET = {
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  v2DutchReactor: "0x00000011f84b9aa48e5f8aa8b9897600006289be",
};

async function main() {
  const { ethers, network } = hre;
  const [deployer] = await ethers.getSigners();
  console.log("Network:", network.name, "Deployer:", deployer.address);

  let permit2 = MAINNET.permit2;
  let reactor = MAINNET.v2DutchReactor;

  const useMocks =
    network.name === "hardhat" ||
    network.name === "localhost" ||
    (network.name === "sepolia" && !process.env.UNISWAPX_REACTOR_ADDRESS);

  if (useMocks) {
    const MockPermit2 = await ethers.getContractFactory("MockPermit2");
    const mp = await MockPermit2.deploy();
    await mp.waitForDeployment();
    permit2 = await mp.getAddress();
    const MockReactor = await ethers.getContractFactory("MockUniswapXReactor");
    const mr = await MockReactor.deploy(permit2);
    await mr.waitForDeployment();
    reactor = await mr.getAddress();
    console.log("Using MockPermit2:", permit2);
    console.log("Using MockUniswapXReactor:", reactor);
  } else if (network.name === "sepolia") {
    permit2 = process.env.PERMIT2_ADDRESS || "0x000000000022D473030F116dDEE9F6B43aC78BA3";
    reactor = process.env.UNISWAPX_REACTOR_ADDRESS;
    console.log("Sepolia Permit2:", permit2);
    console.log("Sepolia UniswapX reactor:", reactor);
  }

  const UniswapXPayout = await ethers.getContractFactory("UniswapXPayout");
  const payout = await UniswapXPayout.deploy(permit2, reactor);
  await payout.waitForDeployment();
  console.log("UniswapXPayout:", await payout.getAddress());

  const AgentEscrow = await ethers.getContractFactory("AgentEscrow");
  const escrow = await AgentEscrow.deploy(await payout.getAddress());
  await escrow.waitForDeployment();
  console.log("AgentEscrow:", await escrow.getAddress());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
