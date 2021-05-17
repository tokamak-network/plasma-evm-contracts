pragma solidity ^0.5.12;

import { Ownable } from "@openzeppelin/contracts/ownership/Ownable.sol";


interface MinterRoleRenounceTarget {
  function renounceMinter() external;
}

interface PauserRoleRenounceTarget {
  function renouncePauser() external;
}

interface OwnableTarget {
  function renounceOwnership() external;
  function transferOwnership(address newOwner) external;
}

contract AuthController is Ownable {
  function renounceMinter(address target) public onlyOwner {
    MinterRoleRenounceTarget(target).renounceMinter();
  }

  function renouncePauser(address target) public onlyOwner {
    PauserRoleRenounceTarget(target).renouncePauser();
  }

  function renounceOwnership(address target) public onlyOwner {
    OwnableTarget(target).renounceOwnership();
  }

  function transferOwnership(address target, address newOwner) public onlyOwner {
    OwnableTarget(target).transferOwnership(newOwner);
  }
}