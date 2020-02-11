pragma solidity ^0.5.12;

import "../lib/BMT.sol";


contract BMTMock {
  using BMT for bytes32[];

  uint constant public MAX_LEAVES = 2 ** 16;
  bytes32[] public leaves;
  bytes32 public root;

  function getLeavesCount() public view returns (uint) {
    return leaves.length;
  }

  function addLeaf(bytes32 _leaf) public {
    leaves.push(_leaf);
  }

  function addLeaves(bytes32[] memory _leaves) public {
    require(_leaves.length > 0);
    for(uint i = 0; i < _leaves.length; i++) {
      leaves.push(_leaves[i]);
    }
  }

  function checkRoot(bytes32 _root) public view returns (bool) {
    return getRoot() == _root;
  }

  function setRoot() public {
    root = getRoot();
  }

  function getRoot() public view returns (bytes32) {
    return leaves.getRoot();
  }
}
