pragma solidity ^0.5.12;

import { CustomIncrementCoinageMock } from "../../../node_modules/coinage-token/flatten.sol";
import { CoinageFactoryI } from "../interfaces/CoinageFactoryI.sol";

contract CoinageFactory is CoinageFactoryI {
  uint256 constant public RAY = 10 ** 27; // 1 RAY
  uint256 constant internal _DEFAULT_FACTOR = RAY;

  address public seigManager;

  function deploy() external returns (address) {
    require(seigManager != address(0), "SeigManager address is zero");
    CustomIncrementCoinageMock c = new CustomIncrementCoinageMock(
      "",
      "",
      _DEFAULT_FACTOR,
      false
    );

    c.addMinter(seigManager);
    c.renounceMinter();
    c.transferOwnership(seigManager);

    return address(c);
  }

  function setSeigManager(address seigManager_) external {
    seigManager = seigManager_;
  }
}
