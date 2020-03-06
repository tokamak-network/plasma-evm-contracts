pragma solidity ^0.5.12;


interface PowerTONI {
  function seigManager() external returns (address);
  function wton() external returns (address);

  function currentRound() external returns (uint256);
  function roundDuration() external returns (uint256);
  function totalDeposits() external returns (uint256);

  function powerOf(address account) external returns (uint256);

  function start() external;
  function endRound() external;

  function onDeposit(address rootchain, address account, uint256 amount) external;
  function onWithdraw(address rootchain, address account, uint256 amount) external;
}