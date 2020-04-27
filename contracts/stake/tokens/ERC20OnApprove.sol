pragma solidity ^0.5.12;

import { ERC20 } from "../../../node_modules/openzeppelin-solidity/contracts/token/ERC20/ERC20.sol";
import { ERC165Checker } from "../../../node_modules/openzeppelin-solidity/contracts/introspection/ERC165Checker.sol";

import { OnApproveConstant } from "./OnApproveConstant.sol";


contract ERC20OnApprove is ERC20, OnApproveConstant {
  function approveAndCall(address spender, uint256 amount, bytes memory data) public returns (bool) {
    require(approve(spender, amount));
    _callOnApprove(msg.sender, spender, amount, data);
  }

  function _callOnApprove(address owner, address spender, uint256 amount, bytes memory data) internal {
    require(ERC165Checker._supportsInterface(spender, INTERFACE_ID_ON_APPROVE),
      "ERC20OnApprove: spender doesn't support onApprove");

    (bool ok, bytes memory res) = spender.call(
      abi.encodeWithSelector(
        INTERFACE_ID_ON_APPROVE,
        owner,
        spender,
        amount,
        data
      )
    );

    // check if low-level call reverted or not
    require(ok, string(res));

    assembly {
      ok := mload(add(res, 0x20))
    }

    // check if OnApprove.onApprove returns true or false
    require(ok, "ERC20OnApprove: failed to call onApprove");
  }

}