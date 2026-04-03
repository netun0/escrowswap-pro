// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/IUniswapXReactor.sol";
import "./interfaces/IPermit2Allowance.sol";

/**
 * @title UniswapXPayout
 * @notice Escrow helper: pulls input token, authorizes Permit2 for the reactor, then calls UniswapX `execute`.
 * @dev The signed `order` must be a valid UniswapX order whose `swapper` is **this contract** and whose
 *      outputs pay the worker. Build `order` + `sig` off-chain with the uniswapx-sdk (npm) against the
 *      target chain reactor (e.g. mainnet V2 Dutch reactor). Same tx is normally submitted by a filler;
 *      here the escrow flow calls `verifyWithUniswapXOrder` so the verifier supplies the fresh signed order.
 *      Local tests use `MockUniswapXReactor` instead of a real reactor.
 */
contract UniswapXPayout {
    using SafeERC20 for IERC20;

    IPermit2Allowance public immutable permit2;
    IUniswapXReactor public immutable reactor;

    uint48 private constant _PERMIT_EXPIRATION_WINDOW = 1 hours;

    error ZeroAddress();

    constructor(address _permit2, address _reactor) {
        if (_permit2 == address(0) || _reactor == address(0)) revert ZeroAddress();
        permit2 = IPermit2Allowance(_permit2);
        reactor = IUniswapXReactor(_reactor);
    }

    /**
     * @notice Uses `amountIn` of `tokenIn` already held by this contract, approves Permit2, then `reactor.execute`.
     * @dev AgentEscrow must `transfer` escrowed funds to this contract immediately before calling.
     * @param tokenIn ERC-20 balance location for the swap input.
     * @param amountIn Amount consumed (must be <= balance of this contract).
     * @param signedOrder UniswapX `SignedOrder` (encoded order + swapper signature).
     */
    function executeSignedOrder(
        address tokenIn,
        uint256 amountIn,
        IUniswapXReactor.SignedOrder calldata signedOrder
    ) external payable {
        require(IERC20(tokenIn).balanceOf(address(this)) >= amountIn, "UniswapXPayout: balance");
        IERC20(tokenIn).forceApprove(address(permit2), amountIn);
        permit2.approve(
            tokenIn,
            address(reactor),
            uint160(amountIn),
            uint48(block.timestamp + _PERMIT_EXPIRATION_WINDOW)
        );
        reactor.execute{value: msg.value}(signedOrder);
        uint256 leftover = IERC20(tokenIn).balanceOf(address(this));
        if (leftover > 0) {
            IERC20(tokenIn).safeTransfer(msg.sender, leftover);
        }
    }
}

