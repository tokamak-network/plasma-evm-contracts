pragma solidity ^0.5.12;

import { SeigManagerI } from "./SeigManagerI.sol";
import { RootChainI } from "../../RootChainI.sol";


interface RootChainRegistryI {
  function rootchains(address rootchain) external view returns (bool);

  function register(address rootchain) external returns (bool);
  function numRootChains() external view returns (uint256);
  function rootchainByIndex(uint256 index) external view returns (address);

  function deployCoinage(address rootchain, address seigManager) external returns (bool);
  function registerAndDeployCoinage(address rootchain, address seigManager) external returns (bool);
  function unregister(address rootchain) external returns (bool);
}