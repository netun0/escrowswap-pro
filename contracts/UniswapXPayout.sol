// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/interfaces/IERC1271.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./interfaces/IUniswapXReactor.sol";
import "./interfaces/IPermit2Allowance.sol";

/**
 * @title UniswapXPayout
 * @notice Escrow helper: pulls input token, authorizes Permit2 for the reactor, then calls UniswapX `execute`.
 * @dev The signed `order` must be a valid UniswapX order whose `swapper` is **this contract** and whose
 *      outputs pay the worker. Build `order` + `sig` off-chain with the uniswapx-sdk (npm) against the
 *      target chain reactor (e.g. mainnet V2 Dutch reactor). Same tx is normally submitted by a filler;
 *      here the escrow flow calls `verifyWithUniswapXOrder` so the verifier supplies the fresh signed order.
 *      ERC-1271 support lets Permit2 validate a verifier-produced signature while this contract is the
 *      swapper. Local tests use `MockUniswapXReactor` instead of a real reactor.
 */
contract UniswapXPayout is IERC1271 {
    using SafeERC20 for IERC20;

    IPermit2Allowance public immutable permit2;
    IUniswapXReactor public immutable reactor;
    address public immutable owner;
    address public escrow;

    uint48 private constant _PERMIT_EXPIRATION_WINDOW = 1 hours;
    bytes4 private constant _INVALID_SIGNATURE = 0xffffffff;
    address private _activeOrderSigner;

    error ZeroAddress();
    error OnlyOwner();
    error OnlyEscrow();
    error EscrowAlreadySet();
    error InvalidOrderSigner();

    constructor(address _permit2, address _reactor) {
        if (_permit2 == address(0) || _reactor == address(0)) revert ZeroAddress();
        permit2 = IPermit2Allowance(_permit2);
        reactor = IUniswapXReactor(_reactor);
        owner = msg.sender;
    }

    function setEscrow(address _escrow) external {
        if (msg.sender != owner) revert OnlyOwner();
        if (escrow != address(0)) revert EscrowAlreadySet();
        if (_escrow == address(0)) revert ZeroAddress();
        escrow = _escrow;
    }

    /**
     * @notice Uses `amountIn` of `tokenIn` already held by this contract, approves Permit2, then `reactor.execute`.
     * @dev AgentEscrow must `transfer` escrowed funds to this contract immediately before calling.
     * @param tokenIn ERC-20 balance location for the swap input.
     * @param amountIn Amount consumed (must be <= balance of this contract).
     * @param orderSigner Verifier wallet whose signature Permit2 should accept for this execution.
     * @param signedOrder UniswapX `SignedOrder` (encoded order + swapper signature).
     */
    function executeSignedOrder(
        address tokenIn,
        uint256 amountIn,
        address orderSigner,
        IUniswapXReactor.SignedOrder calldata signedOrder
    ) external payable {
        if (msg.sender != escrow) revert OnlyEscrow();
        if (orderSigner == address(0)) revert InvalidOrderSigner();
        require(IERC20(tokenIn).balanceOf(address(this)) >= amountIn, "UniswapXPayout: balance");
        IERC20(tokenIn).forceApprove(address(permit2), amountIn);
        permit2.approve(
            tokenIn,
            address(reactor),
            uint160(amountIn),
            uint48(block.timestamp + _PERMIT_EXPIRATION_WINDOW)
        );
        _activeOrderSigner = orderSigner;
        reactor.execute{value: msg.value}(signedOrder);
        _activeOrderSigner = address(0);
        uint256 leftover = IERC20(tokenIn).balanceOf(address(this));
        if (leftover > 0) {
            IERC20(tokenIn).safeTransfer(msg.sender, leftover);
        }
    }

    function isValidSignature(bytes32 hash, bytes memory signature) external view override returns (bytes4) {
        if (_activeOrderSigner == address(0)) return _INVALID_SIGNATURE;

        (uint8 v, bytes32 r, bytes32 s) = ECDSA.parse(signature);
        (address recovered, ECDSA.RecoverError err, ) = ECDSA.tryRecover(hash, v, r, s);
        if (err != ECDSA.RecoverError.NoError || recovered != _activeOrderSigner) {
            return _INVALID_SIGNATURE;
        }

        return IERC1271.isValidSignature.selector;
    }
}
