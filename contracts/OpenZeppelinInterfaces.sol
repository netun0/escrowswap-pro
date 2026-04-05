// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {IERC5267} from "@openzeppelin/contracts/interfaces/IERC5267.sol";
import {
    IERC20Errors,
    IERC721Errors,
    IERC1155Errors
} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";

interface OpenZeppelinInterfaces is IERC1271, IERC5267, IERC20Errors, IERC721Errors, IERC1155Errors {}
