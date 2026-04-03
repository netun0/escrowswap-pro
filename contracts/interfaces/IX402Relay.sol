// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IX402Relay
 * @notice Interface for x402 agent-to-agent micropayments
 * @dev Lightweight payment channel for sub-service calls between agents
 */

struct MicroPayment {
    uint256 id;
    address payer;
    address provider;
    address token;
    uint256 amount;
    bytes32 callHash;    // Hash of the API call or service request
    uint256 timestamp;
    bool settled;
}

interface IX402Relay {
    event PaymentSent(uint256 indexed paymentId, address indexed payer, address indexed provider, uint256 amount, bytes32 callHash);
    event PaymentSettled(uint256 indexed paymentId);
    event ChannelFunded(address indexed agent, uint256 amount);

    function fundChannel(address token, uint256 amount) external;
    function payForCall(address provider, address token, uint256 amount, bytes32 callHash) external returns (uint256 paymentId);
    function settlePayment(uint256 paymentId) external;
    function getChannelBalance(address agent, address token) external view returns (uint256);
    function getPayment(uint256 paymentId) external view returns (MicroPayment memory);
}
