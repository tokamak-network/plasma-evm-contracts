pragma solidity ^0.5.12;


interface SeigManagerI {
  function deployCoinage(address rootchain) external returns (bool);
  function onTransfer(address sender, address recipient, uint256 amount) external returns (bool);
  function onCommit() external returns (bool);
  function onStake(address rootchain, address depositor, uint256 amount) external returns (bool);
  function onUnstake(address rootchain, address depositor, uint256 amount) external returns (bool);
  function uncomittedRewardOf(address rootchain, address depositor) external view returns (uint256);
  function rewardOf(address rootchain, address depositor) external view returns (uint256);
}