pragma solidity ^0.5.12;

import { ERC165 } from "../../../node_modules/openzeppelin-solidity/contracts/introspection/ERC165.sol";
import { OnApproveConstant } from "./OnApproveConstant.sol";


contract OnApprove is OnApproveConstant, ERC165 {
  constructor() public {
    _registerInterface(INTERFACE_ID_ON_APPROVE);
  }

  function onApprove(address owner, address spender, uint256 amount, bytes calldata data) external returns (bool);
}