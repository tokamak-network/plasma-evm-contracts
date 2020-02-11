pragma solidity ^0.5.12;

import "../lib/Roles.sol";


contract SubmitterRole {
  using Roles for Roles.Role;

  event SubmitterAdded(address indexed account);
  event SubmitterRemoved(address indexed account);

  Roles.Role private _submitters;

  constructor () internal {
    _addSubmitter(msg.sender);
  }

  modifier onlySubmitter() {
    require(isSubmitter(msg.sender));
    _;
  }

  function isSubmitter(address account) public view returns (bool) {
    return _submitters.has(account);
  }

  function addSubmitter(address account) public onlySubmitter {
    _addSubmitter(account);
  }

  function renounceSubmitter() public {
    _removeSubmitter(msg.sender);
  }

  function _addSubmitter(address account) internal {
    _submitters.add(account);
    emit SubmitterAdded(account);
  }

  function _removeSubmitter(address account) internal {
    _submitters.remove(account);
    emit SubmitterRemoved(account);
  }
}
