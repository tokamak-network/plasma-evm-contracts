pragma solidity ^0.5.12;

interface Layer2I {
  function operator() external view returns (address);
  function isLayer2() external view returns (bool);
  function currentFork() external view returns (uint);
  function lastEpoch(uint forkNumber) external view returns (uint);
  function changeOperator(address _operator) external;
}
