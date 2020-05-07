pragma solidity ^0.5.12;


interface DepositManagerI {
  function owner() external view returns (address);
  function wton() external view returns (address);
  function registry() external view returns (address);
  function seigManager() external view returns (address);

  function accStaked(address rootchain, address account) external view returns (uint256 wtonAmount);
  function accStakedRootChain(address rootchain) external view returns (uint256 wtonAmount);
  function accStakedAccount(address account) external view returns (uint256 wtonAmount);

  function pendingUnstaked(address rootchain, address account) external view returns (uint256 wtonAmount);
  function pendingUnstakedRootChain(address rootchain) external view returns (uint256 wtonAmount);
  function pendingUnstakedAccount(address account) external view returns (uint256 wtonAmount);

  function accUnstaked(address rootchain, address account) external view returns (uint256 wtonAmount);
  function accUnstakedRootChain(address rootchain) external view returns (uint256 wtonAmount);
  function accUnstakedAccount(address account) external view returns (uint256 wtonAmount);


  function withdrawalRequestIndex(address rootchain, address account) external view returns (uint256 index);
  function withdrawalRequest(address rootchain, address account, uint256 index) external view returns (uint128 withdrawableBlockNumber, uint128 amount, bool processed );

  function WITHDRAWAL_DELAY() external view returns (uint256);

  function setSeigManager(address seigManager) external;
  function deposit(address rootchain, uint256 amount) external returns (bool);
  function requestWithdrawal(address rootchain, uint256 amount) external returns (bool);
  function processRequest(address rootchain) external returns (bool);
  function requestWithdrawalAll(address rootchain) external returns (bool);
  function processRequests(address rootchain, uint256 n) external returns (bool);

  function numRequests(address rootchain, address account) external view returns (uint256);
  function numPendingRequests(address rootchain, address account) external view returns (uint256);
}
