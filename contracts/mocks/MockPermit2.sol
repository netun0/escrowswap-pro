// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev Minimal Permit2 double: allowance mapping + transferFrom that uses ERC20.transferFrom from `from`.
contract MockPermit2 {
    mapping(address owner => mapping(address token => mapping(address spender => uint256))) public allowanceAmt;

    function approve(address token, address spender, uint160 amount, uint48) external {
        allowanceAmt[msg.sender][token][spender] = uint256(amount);
    }

    function transferFrom(address from, address to, uint160 amount, address token) external {
        uint256 a = allowanceAmt[from][token][msg.sender];
        require(a >= uint256(amount), "MockPermit2: allowance");
        allowanceAmt[from][token][msg.sender] = a - uint256(amount);
        require(IERC20(token).transferFrom(from, to, uint256(amount)), "MockPermit2: transferFrom");
    }
}
