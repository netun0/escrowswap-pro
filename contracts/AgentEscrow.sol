// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/IERC8183Escrow.sol";

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IUniswapPayout {
    function swapAndPay(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        address recipient,
        uint24 maxSlippage
    ) external returns (uint256 amountOut);
}

/**
 * @title AgentEscrow
 * @notice ERC-8183 compliant agent-to-agent escrow with Uniswap payout routing
 * @dev Manages the full lifecycle: Open → Funded → Submitted → Verified → PaidOut
 */
contract AgentEscrow is IERC8183Escrow {
    uint256 private _taskCounter;
    mapping(uint256 => Task) private _tasks;
    IUniswapPayout public uniswapPayout;

    constructor(address _uniswapPayout) {
        uniswapPayout = IUniswapPayout(_uniswapPayout);
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

    function fundTask(uint256 taskId)
        external
        onlyClient(taskId)
        inState(taskId, TaskState.Open)
    {
        Task storage task = _tasks[taskId];
        IERC20(task.paymentToken).transferFrom(msg.sender, address(this), task.amount);
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

    function verify(uint256 taskId, bool approved)
        external
        onlyVerifier(taskId)
        inState(taskId, TaskState.Submitted)
    {
        Task storage task = _tasks[taskId];

        if (approved) {
            task.state = TaskState.Verified;
            task.verifiedAt = block.timestamp;
            emit WorkVerified(taskId, msg.sender, true);
            _executePayout(taskId);
        } else {
            task.state = TaskState.Refunded;
            task.completedAt = block.timestamp;
            IERC20(task.paymentToken).transfer(task.client, task.amount);
            emit WorkVerified(taskId, msg.sender, false);
            emit TaskRefunded(taskId, task.client, task.amount);
        }
    }

    function dispute(uint256 taskId) external {
        Task storage task = _tasks[taskId];
        require(
            msg.sender == task.client || msg.sender == task.worker,
            "Not participant"
        );
        require(
            task.state == TaskState.Funded || task.state == TaskState.Submitted,
            "Cannot dispute"
        );
        task.state = TaskState.Disputed;
        emit TaskDisputed(taskId, msg.sender);
    }

    function _executePayout(uint256 taskId) internal {
        Task storage task = _tasks[taskId];

        if (task.paymentToken == task.workerPreferredToken) {
            // Direct transfer, no swap needed
            IERC20(task.paymentToken).transfer(task.worker, task.amount);
            task.state = TaskState.PaidOut;
            task.completedAt = block.timestamp;
            emit PayoutCompleted(taskId, task.worker, task.paymentToken, task.amount);
        } else {
            // Swap via Uniswap and pay worker
            IERC20(task.paymentToken).approve(address(uniswapPayout), task.amount);
            uint256 amountOut = uniswapPayout.swapAndPay(
                task.paymentToken,
                task.workerPreferredToken,
                task.amount,
                task.worker,
                500 // 0.05% max slippage (basis points)
            );
            task.state = TaskState.PaidOut;
            task.completedAt = block.timestamp;
            emit PayoutCompleted(taskId, task.worker, task.workerPreferredToken, amountOut);
        }
    }

    function getTask(uint256 taskId) external view returns (Task memory) {
        return _tasks[taskId];
    }

    function getTaskCount() external view returns (uint256) {
        return _taskCounter;
    }
}
