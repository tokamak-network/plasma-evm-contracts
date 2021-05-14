pragma solidity ^0.5.12;

import { ERC165 } from "@openzeppelin/contracts/introspection/ERC165.sol";

contract SwapProxy is ERC165 {
  constructor() public {
    _registerInterface(SwapProxy(this).onApprove.selector);
  }

  function onApprove(
    address owner,
    address spender,
    uint256 tonAmount,
    bytes calldata data
  ) external returns (bool) {
    return true;
  }
}
