pragma solidity ^0.5.0;

import { Ownable } from "openzeppelin-solidity/contracts/ownership/OWnable.sol";
import { CustomIncrementCoinageMock as CustomIncrementCoinage } from "coinage-token/contracts/mock/CustomIncrementCoinageMock.sol";
import { SeigManagerI } from "./SeigManagerI.sol";

import { RootChainI } from "../RootChainI.sol";


// TODO: transfer coinages ownership to seig manager
contract RootChainRegistry is Ownable {
  // check whether the address is root chain contract or not
  mapping (address => bool) public rootchains;

  function register(address rootchain) public returns (bool) {
    require(!rootchains[rootchain]);
    require(RootChainI(rootchain).isRootChain());

    if (!isOwner()) {
      require(msg.sender == RootChainI(rootchain).operator());
    }

    rootchains[rootchain] = true;

    return true;
  }

  function deployCoinage(address rootchain, address seigManager) public returns (bool) {
    return SeigManagerI(seigManager).deployCoinage(rootchain);
  }


  function registerAndDeployCoinage(
    address rootchain,
    address seigManager
  ) public returns (bool) {
    require(register(rootchain));
    require(deployCoinage(rootchain, seigManager));
    return true;
  }

  function unregister(address rootchain) external onlyOwner returns (bool) {
    require(rootchains[rootchain]);

    rootchains[rootchain] = false;
  }
}
