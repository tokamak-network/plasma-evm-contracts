pragma solidity ^0.5.12;

import { Ownable } from "@openzeppelin/contracts/ownership/Ownable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";


contract ERC20MultiTransfer {
  using SafeERC20 for IERC20;

  function transferFixedAmount(
    IERC20 token,
    address[] calldata targets,
    uint256 amount
  ) external {
    token.safeTransferFrom(msg.sender, address(this), amount * targets.length);

    for (uint256 i = 0; i < targets.length; i++) {
      address target = targets[i];
      token.safeTransfer(target, amount);
    }
  }
}