require("dotenv").config();
require("@nomicfoundation/hardhat-ethers");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.28",
    settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: "cancun" },
  },
  paths: {
    sources: "./contracts",
    tests: "./hardhat/test",
    cache: "./hardhat/cache",
    artifacts: "./hardhat/artifacts",
  },
  networks: {
    hardhat: {},
    hedera_testnet: {
      url: process.env.HEDERA_EVM_RPC || "https://testnet.hashio.io/api",
      chainId: 296,
      accounts: process.env.DEPLOYER_EVM_PRIVATE_KEY ? [process.env.DEPLOYER_EVM_PRIVATE_KEY] : [],
    },
  },
};
