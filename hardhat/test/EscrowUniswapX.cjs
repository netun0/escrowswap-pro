const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = hre;

describe("AgentEscrow + UniswapXPayout (Mock UniswapX)", function () {
  async function deployFixture() {
    const [deployer, client, worker, verifier] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const usdc = await MockERC20.deploy("USD Coin", "USDC", 6);
    const weth = await MockERC20.deploy("Wrapped Ether", "WETH", 18);

    const MockPermit2 = await ethers.getContractFactory("MockPermit2");
    const permit2 = await MockPermit2.deploy();

    const MockReactor = await ethers.getContractFactory("MockUniswapXReactor");
    const reactor = await MockReactor.deploy(await permit2.getAddress());

    const UniswapXPayout = await ethers.getContractFactory("UniswapXPayout");
    const payout = await UniswapXPayout.deploy(await permit2.getAddress(), await reactor.getAddress());

    const AgentEscrow = await ethers.getContractFactory("AgentEscrow");
    const escrow = await AgentEscrow.deploy(await payout.getAddress());
    await payout.setEscrow(await escrow.getAddress());

    const amount = 1_000_000n; // 1 USDC
    const amountOut = ethers.parseEther("0.001");

    await usdc.mint(client.address, amount * 10n);
    await weth.mint(await reactor.getAddress(), amountOut * 10n);

    return {
      escrow,
      payout,
      reactor,
      permit2,
      usdc,
      weth,
      client,
      worker,
      verifier,
      deployer,
      amount,
      amountOut,
    };
  }

  it("same-token verify pays worker without UniswapX order", async function () {
    const { escrow, usdc, client, worker, verifier, amount } = await deployFixture();

    await usdc.connect(client).approve(await escrow.getAddress(), amount);

    await escrow
      .connect(client)
      .createTask("ipfs://spec", worker.address, verifier.address, await usdc.getAddress(), amount, await usdc.getAddress());

    await escrow.connect(client).fundTask(0);
    await escrow.connect(worker).submitWork(0, "ipfs://out");
    await expect(escrow.connect(verifier).verify(0, true)).to.emit(escrow, "PayoutCompleted");

    expect(await usdc.balanceOf(worker.address)).to.equal(amount);
  });

  it("cross-token verifyWithUniswapXOrder uses mock reactor", async function () {
    const { escrow, payout, reactor, usdc, weth, client, worker, verifier, amount, amountOut } =
      await deployFixture();

    await usdc.connect(client).approve(await escrow.getAddress(), amount);

    await escrow
      .connect(client)
      .createTask(
        "ipfs://spec",
        worker.address,
        verifier.address,
        await usdc.getAddress(),
        amount,
        await weth.getAddress()
      );

    await escrow.connect(client).fundTask(0);
    await escrow.connect(worker).submitWork(0, "ipfs://out");

    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    const orderPayload = abiCoder.encode(
      ["tuple(address swapper,address tokenIn,uint256 amountIn,address tokenOut,address recipient,uint256 amountOut)"],
      [
        {
          swapper: await payout.getAddress(),
          tokenIn: await usdc.getAddress(),
          amountIn: amount,
          tokenOut: await weth.getAddress(),
          recipient: worker.address,
          amountOut,
        },
      ]
    );

    await expect(
      escrow.connect(verifier).verifyWithUniswapXOrder(0, true, orderPayload, "0x")
    ).to.emit(escrow, "PayoutCompleted");

    expect(await weth.balanceOf(worker.address)).to.equal(amountOut);
  });

  it("payout only accepts signed-order execution from the configured escrow", async function () {
    const { payout, usdc, verifier, amount } = await deployFixture();

    await usdc.mint(await payout.getAddress(), amount);

    await expect(
      payout.connect(verifier).executeSignedOrder(await usdc.getAddress(), amount, verifier.address, { order: "0x", sig: "0x" })
    ).to.be.revertedWithCustomError(payout, "OnlyEscrow");
  });

  it("verify reverts on cross-token without UniswapX path", async function () {
    const { escrow, usdc, weth, client, worker, verifier, amount } = await deployFixture();

    await usdc.connect(client).approve(await escrow.getAddress(), amount);

    await escrow
      .connect(client)
      .createTask(
        "ipfs://spec",
        worker.address,
        verifier.address,
        await usdc.getAddress(),
        amount,
        await weth.getAddress()
      );

    await escrow.connect(client).fundTask(0);
    await escrow.connect(worker).submitWork(0, "ipfs://out");

    await expect(escrow.connect(verifier).verify(0, true)).to.be.revertedWithCustomError(
      escrow,
      "CrossTokenNeedsUniswapX"
    );
  });
});
