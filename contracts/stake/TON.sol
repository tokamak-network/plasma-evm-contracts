pragma solidity ^0.5.0;

import { Ownable } from "../../node_modules/openzeppelin-solidity/contracts/ownership/OWnable.sol";
import { ERC20Mintable } from "../../node_modules/openzeppelin-solidity/contracts/token/ERC20/ERC20Mintable.sol";
import { ERC20Detailed } from "../../node_modules/openzeppelin-solidity/contracts/token/ERC20/ERC20Detailed.sol";

import { SeigManagerI } from "./SeigManagerI.sol";
import { SeigToken } from "./SeigToken.sol";


/**
 * @dev Current implementations is just for testing seigniorage manager.
 */
contract TON is Ownable, ERC20Mintable, ERC20Detailed, SeigToken {
  constructor() public ERC20Detailed("Tokamak Network Token", "TON", 18) {}
}