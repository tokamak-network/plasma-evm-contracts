pragma solidity ^0.4.24;


contract MerkleTest {
  uint constant public MAX_LEAVES = 2 ** 16;
  bytes32[] public leaves;
  bytes32 public root;

  function getLeavesCount() public view returns (uint) {
    return leaves.length;
  }

  function addLeaf(bytes32 _leaf) public {
    leaves.push(_leaf);
  }

  function addLeaves(bytes32[] _leaves) public {
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
    return _getRoot(leaves);
  }

  // TODO: remove recursive call
  function _getRoot(bytes32[] memory level) internal view returns (bytes32) {
    if (level.length == 1) return level[0];

    bytes32[] memory nextLevel = new bytes32[]((level.length + 1) / 2);
    uint i;

    for(; i + 1 < level.length; i += 2) {
      nextLevel[i/2] = keccak256(abi.encodePacked(level[i], level[i+1]));
    }

    if (level.length % 2 == 1) {
      nextLevel[i/2] = keccak256(
        abi.encodePacked(level[level.length - 1], level[level.length - 1])
      );
    }

    return _getRoot(nextLevel);
  }
}
