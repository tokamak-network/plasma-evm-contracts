pragma solidity ^0.5.12;

interface RootChainI {
  function operator() external view returns (address);
  function isRootChain() external view returns (bool);
  function currentFork() external view returns (uint);
  function lastEpoch(uint forkNumber) external view returns (uint);
}