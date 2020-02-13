pragma solidity ^0.5.12;

import { Ownable } from "../../../node_modules/openzeppelin-solidity/contracts/ownership/Ownable.sol";


interface MinterRoleRenounceTarget {
  function renounceMinter() external;
}

interface OwnableTarget {
  function renounceOwnership() external;
  function transferOwnership(address newOwner) external;
}

contract AuthController is Ownable {
  function renounceMinter(address target) public onlyOwner {
    MinterRoleRenounceTarget(target).renounceMinter();
  }

  function renounceOwnership(address target) public onlyOwner {
    OwnableTarget(target).renounceOwnership();
  }

  function transferOwnership(address target, address newOwner) public onlyOwner {
    OwnableTarget(target).transferOwnership(newOwner);
  }
}