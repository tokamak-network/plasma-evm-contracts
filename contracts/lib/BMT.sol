pragma solidity ^0.4.24;


library BMT {
  // TODO: remove recursive call
  function getRoot(bytes32[] memory level) internal view returns (bytes32) {
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

    return getRoot(nextLevel);
  }
}
