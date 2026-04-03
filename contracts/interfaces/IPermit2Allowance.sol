// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Subset of Permit2 used by UniswapXPayout (allowance path).
/// @dev Canonical Permit2: https://github.com/Uniswap/permit2
interface IPermit2Allowance {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}
