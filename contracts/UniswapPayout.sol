// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface ISwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params)
        external payable returns (uint256 amountOut);
}

/**
 * @title UniswapPayout
 * @notice Wrapper around Uniswap V3 SwapRouter for escrow payout routing
 * @dev Converts escrowed tokens to worker's preferred token on payout
 */
contract UniswapPayout {
    ISwapRouter public immutable swapRouter;
    uint24 public constant DEFAULT_POOL_FEE = 3000; // 0.3%

    constructor(address _swapRouter) {
        swapRouter = ISwapRouter(_swapRouter);
    }

    /**
     * @notice Swap tokenIn for tokenOut and send to recipient
     * @param tokenIn Input token address
     * @param tokenOut Output token address
     * @param amountIn Amount of tokenIn to swap
     * @param recipient Address to receive tokenOut
     * @param maxSlippage Maximum slippage in basis points (e.g., 500 = 5%)
     * @return amountOut Amount of tokenOut received
     */
    function swapAndPay(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        address recipient,
        uint24 maxSlippage
    ) external returns (uint256 amountOut) {
        // If same token, just transfer directly
        if (tokenIn == tokenOut) {
            IERC20(tokenIn).transferFrom(msg.sender, recipient, amountIn);
            return amountIn;
        }

        // Pull tokens from caller
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenIn).approve(address(swapRouter), amountIn);

        // Calculate minimum output (simple slippage protection)
        // In production, use an oracle for amountOutMinimum
        uint256 amountOutMinimum = (amountIn * (10000 - maxSlippage)) / 10000;

        ISwapRouter.ExactInputSingleParams memory params = ISwapRouter.ExactInputSingleParams({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            fee: DEFAULT_POOL_FEE,
            recipient: recipient,
            deadline: block.timestamp + 300, // 5 min deadline
            amountIn: amountIn,
            amountOutMinimum: amountOutMinimum,
            sqrtPriceLimitX96: 0
        });

        amountOut = swapRouter.exactInputSingle(params);
    }
}
