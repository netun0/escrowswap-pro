import "dotenv/config";
import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import { defineConfig } from "hardhat/config";

const config = defineConfig({
  plugins: [hardhatEthers],
  solidity: {
    profiles: {
      default: {
        version: "0.8.20",
        settings: { optimizer: { enabled: true, runs: 200 } },
      },
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./hardhat/test",
    cache: "./hardhat/cache",
    artifacts: "./hardhat/artifacts",
  },
  networks: {
    hedera_testnet: {
      type: "http",
      chainType: "l1",
      url: process.env.HEDERA_EVM_RPC || "https://testnet.hashio.io/api",
      chainId: 296,
      accounts: process.env.DEPLOYER_EVM_PRIVATE_KEY ? [process.env.DEPLOYER_EVM_PRIVATE_KEY] : [],
    },
  },
});

export default config;
