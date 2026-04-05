const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const agentRelayer = process.env.TREASURY_AGENT_RELAYER || deployer.address;

  console.log("Deployer EVM:", deployer.address);
  console.log("Agent relayer:", agentRelayer);

  const ClaimFactory = await hre.ethers.getContractFactory("PrizeClaimToken");
  const claim = await ClaimFactory.deploy(deployer.address, { gasLimit: 12_000_000 });
  await claim.waitForDeployment();

  const TreasuryFactory = await hre.ethers.getContractFactory("HackathonTreasury");
  const treasury = await TreasuryFactory.deploy(deployer.address, agentRelayer, await claim.getAddress(), {
    gasLimit: 14_000_000,
  });
  await treasury.waitForDeployment();

  await (await claim.transferOwnership(await treasury.getAddress(), { gasLimit: 1_000_000 })).wait();

  console.log("PrizeClaimToken:", await claim.getAddress());
  console.log("HackathonTreasury:", await treasury.getAddress());
  console.log(
    "\nSet in .env:\nTREASURY_CONTRACT_ADDRESS=" +
      (await treasury.getAddress()) +
      "\nPRIZE_CLAIM_TOKEN_ADDRESS=" +
      (await claim.getAddress()),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
