pragma solidity ^0.5.12;

import { Ownable } from "@openzeppelin/contracts/ownership/Ownable.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import { SeigManagerI } from "../interfaces/SeigManagerI.sol";

import { ERC165Checker } from "@openzeppelin/contracts/introspection/ERC165Checker.sol";

import { ERC20OnApprove } from "./ERC20OnApprove.sol";
import { AuthController } from "./AuthController.sol";

contract SeigToken is ERC20, Ownable, ERC20OnApprove, AuthController {
  SeigManagerI public seigManager;
  bool public callbackEnabled;

  function enableCallback(bool _callbackEnabled) external onlyOwner {
    callbackEnabled = _callbackEnabled;
  }

  function setSeigManager(SeigManagerI _seigManager) external onlyOwner {
    seigManager = _seigManager;
  }

  //////////////////////
  // Override ERC20 functions
  //////////////////////

  function transferFrom(address sender, address recipient, uint256 amount) public returns (bool) {
    return super.transferFrom(sender, recipient, amount);
  }

  function _transfer(address sender, address recipient, uint256 amount) internal {
    super._transfer(sender, recipient, amount);
    if (callbackEnabled && address(seigManager) != address(0)) {
      require(seigManager.onTransfer(sender, recipient, amount));
    }
  }

  function _mint(address account, uint256 amount) internal {
    super._mint(account, amount);
    if (callbackEnabled && address(seigManager) != address(0)) {
      require(seigManager.onTransfer(address(0), account, amount));
    }
  }

  function _burn(address account, uint256 amount) internal {
    super._burn(account, amount);
    if (callbackEnabled && address(seigManager) != address(0)) {
      require(seigManager.onTransfer(account, address(0), amount));
    }
  }
}
