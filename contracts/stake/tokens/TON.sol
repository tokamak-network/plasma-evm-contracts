pragma solidity ^0.5.12;

import { Ownable } from "@openzeppelin/contracts/ownership/Ownable.sol";
import { ERC20Mintable } from "@openzeppelin/contracts/token/ERC20/ERC20Mintable.sol";
import { ERC20Detailed } from "@openzeppelin/contracts/token/ERC20/ERC20Detailed.sol";
import { ERC165Checker } from "@openzeppelin/contracts/introspection/ERC165Checker.sol";

import { SeigManagerI } from "../interfaces/SeigManagerI.sol";
import { SeigToken } from "./SeigToken.sol";


/**
 * @dev Current implementations is just for testing seigniorage manager.
 */
contract TON is Ownable, ERC20Mintable, ERC20Detailed, SeigToken {
  constructor() public ERC20Detailed("Tokamak Network Token", "TON", 18) {}

  function setSeigManager(SeigManagerI _seigManager) external {
    revert("TON: TON doesn't allow setSeigManager");
  }
}