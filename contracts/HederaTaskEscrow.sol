// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @notice ERC-20 escrow on Hedera EVM. Tokens are locked in this contract until the verifier calls `release` or `refund`.
 * @dev Fund with the same `taskId` the off-chain API assigns. Client must `approve` this contract before `fundTask`.
 */
contract HederaTaskEscrow {
    using SafeERC20 for IERC20;

    enum Status {
        None,
        Funded,
        Released,
        Refunded
    }

    struct Task {
        address client;
        address worker;
        address verifier;
        IERC20 token;
        uint256 amount;
        Status status;
    }

    mapping(uint256 => Task) public tasks;

    event TaskFunded(uint256 indexed taskId, address indexed client, address worker, address verifier, address token, uint256 amount);
    event Released(uint256 indexed taskId);
    event Refunded(uint256 indexed taskId);

    function fundTask(uint256 taskId, address worker_, address verifier_, IERC20 token_, uint256 amount_) external {
        Task storage t = tasks[taskId];
        require(t.status == Status.None, "task exists");
        require(worker_ != address(0) && verifier_ != address(0) && address(token_) != address(0), "zero addr");
        require(amount_ > 0, "amount");
        t.client = msg.sender;
        t.worker = worker_;
        t.verifier = verifier_;
        t.token = token_;
        t.amount = amount_;
        t.status = Status.Funded;
        token_.safeTransferFrom(msg.sender, address(this), amount_);
        emit TaskFunded(taskId, msg.sender, worker_, verifier_, address(token_), amount_);
    }

    function release(uint256 taskId) external {
        Task storage t = tasks[taskId];
        require(t.status == Status.Funded, "!funded");
        require(msg.sender == t.verifier, "!verifier");
        t.status = Status.Released;
        t.token.safeTransfer(t.worker, t.amount);
        emit Released(taskId);
    }

    function refund(uint256 taskId) external {
        Task storage t = tasks[taskId];
        require(t.status == Status.Funded, "!funded");
        require(msg.sender == t.verifier, "!verifier");
        t.status = Status.Refunded;
        t.token.safeTransfer(t.client, t.amount);
        emit Refunded(taskId);
    }
}
