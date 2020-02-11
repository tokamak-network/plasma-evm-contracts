pragma solidity ^0.5.12;

import "../lib/Roles.sol";


contract MapperRole {
  using Roles for Roles.Role;

  event MapperAdded(address indexed account);
  event MapperRemoved(address indexed account);

  Roles.Role private _mappers;

  constructor () internal {
    _addMapper(msg.sender);
  }

  modifier onlyMapper() {
    require(isMapper(msg.sender));
    _;
  }

  function isMapper(address account) public view returns (bool) {
    return _mappers.has(account);
  }

  function addMapper(address account) public onlyMapper {
    _addMapper(account);
  }

  function renounceMapper() public {
    _removeMapper(msg.sender);
  }

  function _addMapper(address account) internal {
    _mappers.add(account);
    emit MapperAdded(account);
  }

  function _removeMapper(address account) internal {
    _mappers.remove(account);
    emit MapperRemoved(account);
  }
}
