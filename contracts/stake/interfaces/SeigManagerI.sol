pragma solidity ^0.5.12;


interface SeigManagerI {
  function registry() external view returns (address);
  function depositManager() external view returns (address);
  function ton() external view returns (address);
  function wton() external view returns (address);
  function powerton() external view returns (address);
  function tot() external view returns (address);
  function coinages(address rootchain) external view returns (address);
  function commissionRates(address rootchain) external view returns (uint256);

  function lastCommitBlock(address rootchain) external view returns (uint256);
  function seigPerBlock() external view returns (uint256);
  function lastSeigBlock() external view returns (uint256);
  function pausedBlock() external view returns (uint256);
  function unpausedBlock() external view returns (uint256);
  function DEFAULT_FACTOR() external view returns (uint256);

  function deployCoinage(address rootchain) external returns (bool);
  function setCommissionRate(address rootchain, uint256 commission, bool isCommissionRateNegative) external returns (bool);

  function uncomittedStakeOf(address rootchain, address account) external view returns (uint256);
  function stakeOf(address rootchain, address account) external view returns (uint256);
  function additionalTotBurnAmount(address rootchain, address account, uint256 amount) external view returns (uint256 totAmount);

  function onTransfer(address sender, address recipient, uint256 amount) external returns (bool);
  function updateSeigniorage() external returns (bool);
  function onDeposit(address rootchain, address account, uint256 amount) external returns (bool);
  function onWithdraw(address rootchain, address account, uint256 amount) external returns (bool);

}
