/**
 * Deploy UniswapXPayout + AgentEscrow for a network.
 *
 * Env:
 *   DEPLOYER_PRIVATE_KEY        — required on live networks
 *   SEPOLIA_RPC_URL             — optional (default public Sepolia RPC)
 *   ARC_TESTNET_RPC_URL         — optional (default https://rpc.testnet.arc.network)
 *   UNISWAPX_REACTOR_ADDRESS    — use a real reactor on chains where one exists
 *   PERMIT2_ADDRESS             — override canonical Permit2 if needed
 *
 * Canonical addresses:
 *   Permit2 (same on Ethereum, Sepolia, Arc Testnet): 0x000000000022D473030F116dDEE9F6B43aC78BA3
 *   V2 Dutch Order Reactor (Ethereum mainnet only):   0x00000011f84b9aa48e5f8aa8b9897600006289be
 */

const hre = require("hardhat");

const CANONICAL_PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

const MAINNET = {
  permit2: CANONICAL_PERMIT2,
  v2DutchReactor: "0x00000011f84b9aa48e5f8aa8b9897600006289be",
};

async function main() {
  const { ethers, network } = hre;
  const [deployer] = await ethers.getSigners();
  console.log("Network:", network.name, "Deployer:", deployer.address);

  let permit2 = MAINNET.permit2;
  let reactor = MAINNET.v2DutchReactor;

  const isLocal = network.name === "hardhat" || network.name === "localhost";
  const isArc = network.name === "arc_testnet";

  const useMocks =
    isLocal ||
    (network.name === "sepolia" && !process.env.UNISWAPX_REACTOR_ADDRESS) ||
    (isArc && !process.env.UNISWAPX_REACTOR_ADDRESS);

  if (useMocks) {
    if (isArc) {
      permit2 = CANONICAL_PERMIT2;
      console.log("Arc Testnet: using canonical Permit2:", permit2);
    } else {
      const MockPermit2 = await ethers.getContractFactory("MockPermit2");
      const mp = await MockPermit2.deploy();
      await mp.waitForDeployment();
      permit2 = await mp.getAddress();
      console.log("Using MockPermit2:", permit2);
    }
    const MockReactor = await ethers.getContractFactory("MockUniswapXReactor");
    const mr = await MockReactor.deploy(permit2);
    await mr.waitForDeployment();
    reactor = await mr.getAddress();
    console.log("Using MockUniswapXReactor:", reactor);
  } else if (network.name === "sepolia" || isArc) {
    permit2 = process.env.PERMIT2_ADDRESS || CANONICAL_PERMIT2;
    reactor = process.env.UNISWAPX_REACTOR_ADDRESS;
    console.log("Permit2:", permit2);
    console.log("UniswapX reactor:", reactor);
  }

  const UniswapXPayout = await ethers.getContractFactory("UniswapXPayout");
  const payout = await UniswapXPayout.deploy(permit2, reactor);
  await payout.waitForDeployment();
  console.log("UniswapXPayout:", await payout.getAddress());

  const AgentEscrow = await ethers.getContractFactory("AgentEscrow");
  const escrow = await AgentEscrow.deploy(await payout.getAddress());
  await escrow.waitForDeployment();
  console.log("AgentEscrow:", await escrow.getAddress());

  const setEscrowTx = await payout.setEscrow(await escrow.getAddress());
  await setEscrowTx.wait();
  console.log("UniswapXPayout escrow caller:", await payout.escrow());

  if (isArc) {
    console.log("\n--- Arc Testnet deployment complete ---");
    console.log("Set these in your .env:");
    console.log(`  VITE_AGENT_ESCROW_ADDRESS=${await escrow.getAddress()}`);
    console.log(`  VITE_UNISWAP_PAYOUT_ADDRESS=${await payout.getAddress()}`);
    console.log(`Explorer: https://testnet.arcscan.app/address/${await escrow.getAddress()}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
