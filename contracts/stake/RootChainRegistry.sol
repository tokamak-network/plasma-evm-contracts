pragma solidity ^0.5.12;

import { Ownable } from "../../node_modules/openzeppelin-solidity/contracts/ownership/OWnable.sol";

import { RootChainI } from "../RootChainI.sol";

import { SeigManagerI } from "./interfaces/SeigManagerI.sol";
import { RootChainRegistryI } from "./interfaces/RootChainRegistryI.sol";


// TODO: transfer coinages ownership to seig manager
contract RootChainRegistry is RootChainRegistryI, Ownable {
  // check whether the address is root chain contract or not
  mapping (address => bool) internal _rootchains;

  function rootchains(address rootchain) external view returns (bool) {
    return _rootchains[rootchain];
  }

  function register(address rootchain) external returns (bool) {
    return _register(rootchain);
  }

  function _register(address rootchain) internal returns (bool) {
    require(!_rootchains[rootchain]);
    require(RootChainI(rootchain).isRootChain());

    if (!isOwner()) {
      require(msg.sender == RootChainI(rootchain).operator());
    }

    _rootchains[rootchain] = true;

    return true;
  }

  function deployCoinage(address rootchain, address seigManager) external returns (bool) {
    return _deployCoinage(rootchain, seigManager);
  }

  function _deployCoinage(address rootchain, address seigManager) internal returns (bool) {
    return SeigManagerI(seigManager).deployCoinage(rootchain);
  }

  function registerAndDeployCoinage(
    address rootchain,
    address seigManager
  ) external returns (bool) {
    require(_register(rootchain));
    require(_deployCoinage(rootchain, seigManager));
    return true;
  }

  function unregister(address rootchain) external onlyOwner returns (bool) {
    require(_rootchains[rootchain]);

    _rootchains[rootchain] = false;
  }
}