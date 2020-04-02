pragma solidity ^0.5.12;

import { Ownable } from "../../node_modules/openzeppelin-solidity/contracts/ownership/OWnable.sol";

import { RootChainI } from "../RootChainI.sol";

import { SeigManagerI } from "./interfaces/SeigManagerI.sol";
import { RootChainRegistryI } from "./interfaces/RootChainRegistryI.sol";


// TODO: transfer coinages ownership to seig manager
contract RootChainRegistry is RootChainRegistryI, Ownable {
  // check whether the address is root chain contract or not
  mapping (address => bool) internal _rootchains;

  // array-like storages
  // NOTE: unregistered rootchains could exists in that array. so, should check by rootchains(address)
  uint256 internal _numRootChains;
  mapping (uint256 => address) internal _rootchainByIndex;

  modifier onlyOwnerOrOperator(address rootchain) {
    require(isOwner() || RootChainI(rootchain).operator() == msg.sender, "sender is neither operator nor operator");
    _;
  }

  function rootchains(address rootchain) external view returns (bool) {
    return _rootchains[rootchain];
  }

  function numRootChains() external view returns (uint256) {
    return _numRootChains;
  }

  function rootchainByIndex(uint256 index) external view returns (address) {
    return _rootchainByIndex[index];
  }

  function register(address rootchain)
    external
    onlyOwnerOrOperator(rootchain)
    returns (bool)
  {
    return _register(rootchain);
  }

  function _register(address rootchain) internal returns (bool) {
    require(!_rootchains[rootchain]);
    require(RootChainI(rootchain).isRootChain());

    _rootchains[rootchain] = true;
    _rootchainByIndex[_numRootChains] = rootchain;
    _numRootChains += 1;

    return true;
  }

  function deployCoinage(
    address rootchain,
    address seigManager
  )
    external
    onlyOwnerOrOperator(rootchain)
    returns (bool)
  {
    return _deployCoinage(rootchain, seigManager);
  }

  function _deployCoinage(
    address rootchain,
    address seigManager
  )
   internal
   returns (bool)
  {
    return SeigManagerI(seigManager).deployCoinage(rootchain);
  }

  function registerAndDeployCoinage(
    address rootchain,
    address seigManager
  )
    external
    onlyOwnerOrOperator(rootchain)
    returns (bool)
  {
    require(_register(rootchain));
    require(_deployCoinage(rootchain, seigManager));
    return true;
  }

  function registerAndDeployCoinageAndSetCommissionRate(
    address rootchain,
    address seigManager,
    uint256 commission
  )
    external
    onlyOwnerOrOperator(rootchain)
    returns (bool)
  {
    require(_register(rootchain));
    require(_deployCoinage(rootchain, seigManager));
    require(_setCommissionRate(rootchain, seigManager, commission));
    return true;
  }

  function _setCommissionRate(
    address rootchain,
    address seigManager,
    uint256 commission
  )
    internal
    returns (bool)
  {
    return SeigManagerI(seigManager).setCommissionRate(rootchain, commission);
  }

  function unregister(address rootchain) external onlyOwner returns (bool) {
    require(_rootchains[rootchain]);

    _rootchains[rootchain] = false;
  }
}