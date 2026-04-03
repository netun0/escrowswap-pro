// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IERC8183Escrow
 * @notice Interface for ERC-8183 Agent-to-Agent Escrow
 * @dev Defines the standard escrow lifecycle: Open → Funded → Submitted → Verified → PaidOut
 */

enum TaskState {
    Open,       // Task created, not yet funded
    Funded,     // Client has deposited payment
    Submitted,  // Worker has submitted deliverable
    Verified,   // Verifier has approved the work
    PaidOut,    // Worker has been paid (terminal)
    Refunded,   // Client has been refunded (terminal)
    Disputed    // Dispute raised (requires resolution)
}

struct Task {
    uint256 id;
    address client;
    address worker;
    address verifier;
    string specURI;           // IPFS or HTTP URI to task specification
    string outputURI;         // Worker's deliverable URI
    address paymentToken;     // ERC-20 token used for payment
    uint256 amount;           // Payment amount
    address workerPreferredToken; // Token worker wants to receive
    TaskState state;
    uint256 createdAt;
    uint256 fundedAt;
    uint256 submittedAt;
    uint256 verifiedAt;
    uint256 completedAt;
}

interface IERC8183Escrow {
    event TaskCreated(uint256 indexed taskId, address indexed client, address worker, address verifier, uint256 amount);
    event TaskFunded(uint256 indexed taskId, address indexed client, uint256 amount);
    event WorkSubmitted(uint256 indexed taskId, address indexed worker, string outputURI);
    event WorkVerified(uint256 indexed taskId, address indexed verifier, bool approved);
    event PayoutCompleted(uint256 indexed taskId, address indexed worker, address tokenOut, uint256 amountOut);
    event TaskRefunded(uint256 indexed taskId, address indexed client, uint256 amount);
    event TaskDisputed(uint256 indexed taskId, address indexed disputant);

    function createTask(
        string calldata specURI,
        address worker,
        address verifier,
        address paymentToken,
        uint256 amount,
        address workerPreferredToken
    ) external returns (uint256 taskId);

    function fundTask(uint256 taskId) external;
    function submitWork(uint256 taskId, string calldata outputURI) external;
    function verify(uint256 taskId, bool approved) external;
    function dispute(uint256 taskId) external;
    function getTask(uint256 taskId) external view returns (Task memory);
    function getTaskCount() external view returns (uint256);
}
