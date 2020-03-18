pragma solidity ^0.5.12;


contract OnApproveConstant {
  bytes4 public constant INTERFACE_ID_ON_APPROVE = bytes4(keccak256("onApprove(address,address,uint256,bytes)"));
}