pragma solidity ^0.5.12;

import { Ownable } from "@openzeppelin/contracts/ownership/Ownable.sol";

import { Layer2I } from "../Layer2I.sol";

import { SeigManagerI } from "./interfaces/SeigManagerI.sol";
import { Layer2RegistryI } from "./interfaces/Layer2RegistryI.sol";


// TODO: transfer coinages ownership to seig manager
contract Layer2Registry is Layer2RegistryI, Ownable {
  // check whether the address is layer2 contract or not
  mapping (address => bool) internal _layer2s;

  // array-like storages
  // NOTE: unregistered layer2s could exists in that array. so, should check by layer2s(address)
  uint256 internal _numLayer2s;
  mapping (uint256 => address) internal _layer2ByIndex;

  modifier onlyOwnerOrOperator(address layer2) {
    require(isOwner() || Layer2I(layer2).operator() == msg.sender, "sender is neither operator nor operator");
    _;
  }

  function layer2s(address layer2) external view returns (bool) {
    return _layer2s[layer2];
  }

  function numLayer2s() external view returns (uint256) {
    return _numLayer2s;
  }

  function layer2ByIndex(uint256 index) external view returns (address) {
    return _layer2ByIndex[index];
  }

  function register(address layer2)
    external
    onlyOwnerOrOperator(layer2)
    returns (bool)
  {
    return _register(layer2);
  }

  function _register(address layer2) internal returns (bool) {
    require(!_layer2s[layer2]);
    require(Layer2I(layer2).isLayer2());

    _layer2s[layer2] = true;
    _layer2ByIndex[_numLayer2s] = layer2;
    _numLayer2s += 1;

    return true;
  }

  function deployCoinage(
    address layer2,
    address seigManager
  )
    external
    onlyOwnerOrOperator(layer2)
    returns (bool)
  {
    return _deployCoinage(layer2, seigManager);
  }

  function _deployCoinage(
    address layer2,
    address seigManager
  )
   internal
   returns (bool)
  {
    return SeigManagerI(seigManager).deployCoinage(layer2);
  }

  function registerAndDeployCoinage(
    address layer2,
    address seigManager
  )
    external
    onlyOwnerOrOperator(layer2)
    returns (bool)
  {
    require(_register(layer2));
    require(_deployCoinage(layer2, seigManager));
    return true;
  }

  function registerAndDeployCoinageAndSetCommissionRate(
    address layer2,
    address seigManager,
    uint256 commissionRate,
    bool isCommissionRateNegative
  )
    external
    onlyOwnerOrOperator(layer2)
    returns (bool)
  {
    require(_register(layer2));
    require(_deployCoinage(layer2, seigManager));
    require(_setCommissionRate(layer2, seigManager, commissionRate, isCommissionRateNegative));
    return true;
  }

  function _setCommissionRate(
    address layer2,
    address seigManager,
    uint256 commissionRate,
    bool isCommissionRateNegative
  )
    internal
    returns (bool)
  {
    return SeigManagerI(seigManager).setCommissionRate(layer2, commissionRate, isCommissionRateNegative);
  }

  function unregister(address layer2) external onlyOwner returns (bool) {
    require(_layer2s[layer2]);

    _layer2s[layer2] = false;
  }
}
