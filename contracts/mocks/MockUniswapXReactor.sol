// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IUniswapXReactor.sol";
import "./MockPermit2.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev Hardhat-only reactor: pulls `tokenIn` from `swapper` via MockPermit2, sends `tokenOut` to `recipient`.
/// Encode `SignedOrder.order` as `abi.encode(FakeOrder)`; `sig` can be empty.
contract MockUniswapXReactor is IUniswapXReactor {
    MockPermit2 public immutable permit2;

    struct FakeOrder {
        address swapper;
        address tokenIn;
        uint256 amountIn;
        address tokenOut;
        address recipient;
        uint256 amountOut;
    }

    constructor(MockPermit2 _permit2) {
        permit2 = _permit2;
    }

    function execute(SignedOrder calldata order) external payable override {
        FakeOrder memory fo = abi.decode(order.order, (FakeOrder));
        permit2.transferFrom(fo.swapper, address(this), uint160(fo.amountIn), fo.tokenIn);
        require(IERC20(fo.tokenOut).transfer(fo.recipient, fo.amountOut), "MockReactor: pay");
    }
}
