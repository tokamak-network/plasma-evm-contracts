pragma solidity ^0.5.12;

import { ERC165 } from "@openzeppelin/contracts/introspection/ERC165.sol";

contract OnApprove is ERC165 {
  constructor() public {
    _registerInterface(OnApprove(this).onApprove.selector);
  }

  function onApprove(address owner, address spender, uint256 amount, bytes calldata data) external returns (bool);
}