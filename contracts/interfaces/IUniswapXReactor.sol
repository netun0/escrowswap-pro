// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Minimal UniswapX reactor surface used by UniswapXPayout (matches IReactor.execute).
/// @dev Full protocol: https://github.com/Uniswap/UniswapX
interface IUniswapXReactor {
    struct SignedOrder {
        bytes order;
        bytes sig;
    }

    function execute(SignedOrder calldata order) external payable;
}
