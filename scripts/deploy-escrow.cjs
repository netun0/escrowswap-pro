const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer EVM:", deployer.address);

  const F = await hre.ethers.getContractFactory("HederaTaskEscrow");
  const c = await F.deploy({ gasLimit: 10000000 });
  await c.waitForDeployment();
  const addr = await c.getAddress();
  console.log("HederaTaskEscrow:", addr);
  console.log("\nSet in .env:\nESCROW_CONTRACT_ADDRESS=" + addr + "\nVITE_ESCROW_CONTRACT_ADDRESS=" + addr);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
