// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/IX402Relay.sol";

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title X402Relay
 * @notice Lightweight micropayment channel for agent-to-agent sub-service calls
 * @dev Implements x402 protocol for API call payments between agents
 */
contract X402Relay is IX402Relay {
    uint256 private _paymentCounter;

    // agent => token => balance
    mapping(address => mapping(address => uint256)) private _channelBalances;
    mapping(uint256 => MicroPayment) private _payments;

    function fundChannel(address token, uint256 amount) external {
        IERC20(token).transferFrom(msg.sender, address(this), amount);
        _channelBalances[msg.sender][token] += amount;
        emit ChannelFunded(msg.sender, amount);
    }

    function payForCall(
        address provider,
        address token,
        uint256 amount,
        bytes32 callHash
    ) external returns (uint256 paymentId) {
        require(_channelBalances[msg.sender][token] >= amount, "Insufficient channel balance");

        _channelBalances[msg.sender][token] -= amount;
        paymentId = _paymentCounter++;

        _payments[paymentId] = MicroPayment({
            id: paymentId,
            payer: msg.sender,
            provider: provider,
            token: token,
            amount: amount,
            callHash: callHash,
            timestamp: block.timestamp,
            settled: false
        });

        emit PaymentSent(paymentId, msg.sender, provider, amount, callHash);
    }

    function settlePayment(uint256 paymentId) external {
        MicroPayment storage payment = _payments[paymentId];
        require(msg.sender == payment.provider, "Not provider");
        require(!payment.settled, "Already settled");

        payment.settled = true;
        IERC20(payment.token).transfer(payment.provider, payment.amount);
        emit PaymentSettled(paymentId);
    }

    function getChannelBalance(address agent, address token) external view returns (uint256) {
        return _channelBalances[agent][token];
    }

    function getPayment(uint256 paymentId) external view returns (MicroPayment memory) {
        return _payments[paymentId];
    }
}
