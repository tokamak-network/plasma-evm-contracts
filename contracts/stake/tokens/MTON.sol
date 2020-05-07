pragma solidity ^0.5.12;

import { Ownable } from "../../../node_modules/openzeppelin-solidity/contracts/ownership/Ownable.sol";
import { ERC20Mintable } from "../../../node_modules/openzeppelin-solidity/contracts/token/ERC20/ERC20Mintable.sol";
import { ERC20Detailed } from "../../../node_modules/openzeppelin-solidity/contracts/token/ERC20/ERC20Detailed.sol";
import { ERC165Checker } from "../../../node_modules/openzeppelin-solidity/contracts/introspection/ERC165Checker.sol";

import { SeigManagerI } from "../interfaces/SeigManagerI.sol";
import { SeigToken } from "./SeigToken.sol";


/**
 * @dev Current implementations is just for testing seigniorage manager.
 */
contract MTON is Ownable, ERC20Mintable, ERC20Detailed, SeigToken {
  constructor() public ERC20Detailed("Marketing Tokamak Network Token", "MTON", 18) {}

  function setSeigManager(SeigManagerI _seigManager) external {
    revert("MTON: MTON doesn't allow setSeigManager");
  }
}