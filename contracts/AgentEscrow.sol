// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/IERC8183Escrow.sol";

interface IERC20Escrow {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IUniswapXPayout {
    struct SignedOrder {
        bytes order;
        bytes sig;
    }

    function executeSignedOrder(address tokenIn, uint256 amountIn, address orderSigner, SignedOrder calldata signedOrder)
        external
        payable;
}

/**
 * @title AgentEscrow
 * @notice ERC-8183 escrow with cross-token payout via UniswapX (`UniswapXPayout` + reactor).
 * @dev Same-token payout: `verify(taskId, approved)`.
 *      Cross-token payout: `verifyWithUniswapXOrder(...)` with a signed order built for this chain's reactor.
 */
contract AgentEscrow is IERC8183Escrow {
    uint256 private _taskCounter;
    mapping(uint256 => Task) private _tasks;
    IUniswapXPayout public uniswapPayout;

    error CrossTokenNeedsUniswapX();

    constructor(address _uniswapPayout) {
        uniswapPayout = IUniswapXPayout(_uniswapPayout);
    }

    modifier onlyClient(uint256 taskId) {
        require(msg.sender == _tasks[taskId].client, "Not client");
        _;
    }

    modifier onlyWorker(uint256 taskId) {
        require(msg.sender == _tasks[taskId].worker, "Not worker");
        _;
    }

    modifier onlyVerifier(uint256 taskId) {
        require(msg.sender == _tasks[taskId].verifier, "Not verifier");
        _;
    }

    modifier inState(uint256 taskId, TaskState expected) {
        require(_tasks[taskId].state == expected, "Invalid state");
        _;
    }

    function createTask(
        string calldata specURI,
        address worker,
        address verifier,
        address paymentToken,
        uint256 amount,
        address workerPreferredToken
    ) external returns (uint256 taskId) {
        require(worker != address(0) && verifier != address(0), "Invalid addresses");
        require(amount > 0, "Amount must be > 0");

        taskId = _taskCounter++;
        _tasks[taskId] = Task({
            id: taskId,
            client: msg.sender,
            worker: worker,
            verifier: verifier,
            specURI: specURI,
            outputURI: "",
            paymentToken: paymentToken,
            amount: amount,
            workerPreferredToken: workerPreferredToken,
            state: TaskState.Open,
            createdAt: block.timestamp,
            fundedAt: 0,
            submittedAt: 0,
            verifiedAt: 0,
            completedAt: 0
        });

        emit TaskCreated(taskId, msg.sender, worker, verifier, amount);
    }

    function fundTask(uint256 taskId) external onlyClient(taskId) inState(taskId, TaskState.Open) {
        Task storage task = _tasks[taskId];
        IERC20Escrow(task.paymentToken).transferFrom(msg.sender, address(this), task.amount);
        task.state = TaskState.Funded;
        task.fundedAt = block.timestamp;
        emit TaskFunded(taskId, msg.sender, task.amount);
    }

    function submitWork(uint256 taskId, string calldata outputURI)
        external
        onlyWorker(taskId)
        inState(taskId, TaskState.Funded)
    {
        Task storage task = _tasks[taskId];
        task.outputURI = outputURI;
        task.state = TaskState.Submitted;
        task.submittedAt = block.timestamp;
        emit WorkSubmitted(taskId, msg.sender, outputURI);
    }

    /// @inheritdoc IERC8183Escrow
    /// @dev Use only when `paymentToken == workerPreferredToken` or `approved == false`.
    function verify(uint256 taskId, bool approved)
        external
        onlyVerifier(taskId)
        inState(taskId, TaskState.Submitted)
    {
        Task storage task = _tasks[taskId];
        if (approved && task.paymentToken != task.workerPreferredToken) {
            revert CrossTokenNeedsUniswapX();
        }
        _finalizeVerify(taskId, task, approved, IUniswapXPayout.SignedOrder("", ""));
    }

    /// @notice Approve payout; when tokens differ, executes UniswapX path with a signed order (swapper = UniswapXPayout).
    function verifyWithUniswapXOrder(
        uint256 taskId,
        bool approved,
        bytes calldata uniswapXOrder,
        bytes calldata uniswapXSig
    ) external onlyVerifier(taskId) inState(taskId, TaskState.Submitted) {
        Task storage task = _tasks[taskId];
        if (approved && task.paymentToken != task.workerPreferredToken) {
            require(uniswapXOrder.length > 0, "empty order");
        }
        _finalizeVerify(
            taskId,
            task,
            approved,
            IUniswapXPayout.SignedOrder(uniswapXOrder, uniswapXSig)
        );
    }

    function _finalizeVerify(
        uint256 taskId,
        Task storage task,
        bool approved,
        IUniswapXPayout.SignedOrder memory signedOrder
    ) internal {
        if (!approved) {
            task.state = TaskState.Refunded;
            task.completedAt = block.timestamp;
            IERC20Escrow(task.paymentToken).transfer(task.client, task.amount);
            emit WorkVerified(taskId, msg.sender, false);
            emit TaskRefunded(taskId, task.client, task.amount);
            return;
        }

        task.state = TaskState.Verified;
        task.verifiedAt = block.timestamp;
        emit WorkVerified(taskId, msg.sender, true);

        if (task.paymentToken == task.workerPreferredToken) {
            IERC20Escrow(task.paymentToken).transfer(task.worker, task.amount);
            task.state = TaskState.PaidOut;
            task.completedAt = block.timestamp;
            emit PayoutCompleted(taskId, task.worker, task.paymentToken, task.amount);
        } else {
            IERC20Escrow(task.paymentToken).transfer(address(uniswapPayout), task.amount);
            uniswapPayout.executeSignedOrder(
                task.paymentToken,
                task.amount,
                msg.sender,
                IUniswapXPayout.SignedOrder(signedOrder.order, signedOrder.sig)
            );
            task.state = TaskState.PaidOut;
            task.completedAt = block.timestamp;
            emit PayoutCompleted(taskId, task.worker, task.workerPreferredToken, 0);
        }
    }

    function dispute(uint256 taskId) external {
        Task storage task = _tasks[taskId];
        require(msg.sender == task.client || msg.sender == task.worker, "Not participant");
        require(
            task.state == TaskState.Funded || task.state == TaskState.Submitted,
            "Cannot dispute"
        );
        task.state = TaskState.Disputed;
        emit TaskDisputed(taskId, msg.sender);
    }

    function getTask(uint256 taskId) external view returns (Task memory) {
        return _tasks[taskId];
    }

    function getTaskCount() external view returns (uint256) {
        return _taskCounter;
    }
}
