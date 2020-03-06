pragma solidity ^0.5.12;

import { ERC20Mintable } from "../../../node_modules/openzeppelin-solidity/contracts/token/ERC20/ERC20Mintable.sol";
import { IERC20 } from "../../../node_modules/openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import { CustomIncrementCoinageMock as CustomIncrementCoinage } from "../../../node_modules/coinage-token/flatten.sol";

import { RootChainI } from "../../RootChainI.sol";

import { RootChainRegistryI } from "./RootChainRegistryI.sol";
import { DepositManagerI } from "./DepositManagerI.sol";
import { PowerTONI } from "./PowerTONI.sol";


interface SeigManagerI {
  function registry() external view returns (RootChainRegistryI);
  function depositManager() external view returns (DepositManagerI);
  function ton() external view returns (IERC20);
  function wton() external view returns (ERC20Mintable);
  function powerton() external view returns (PowerTONI);
  function tot() external view returns (CustomIncrementCoinage);
  function coinages(address rootchain) external view returns (CustomIncrementCoinage);

  function lastCommitBlock(address rootchain) external view returns (uint256);
  function seigPerBlock() external view returns (uint256);
  function lastSeigBlock() external view returns (uint256);
  function DEFAULT_FACTOR() external view returns (uint256);

  function deployCoinage(address rootchain) external returns (bool);

  function uncomittedStakeOf(address rootchain, address account) external view returns (uint256);
  function stakeOf(address rootchain, address account) external view returns (uint256);
  function additionalTotBurnAmount(address rootchain, address account, uint256 amount) external view returns (uint256 totAmount);

  function onTransfer(address sender, address recipient, uint256 amount) external returns (bool);
  function onCommit() external returns (bool);
  function onStake(address rootchain, address account, uint256 amount) external returns (bool);
  function onUnstake(address rootchain, address account, uint256 amount) external returns (bool);

}