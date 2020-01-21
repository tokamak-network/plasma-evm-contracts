pragma solidity ^0.5.0;

import { Ownable } from "openzeppelin-solidity/contracts/ownership/Ownable.sol";
import { SafeMath } from "openzeppelin-solidity/contracts/math/SafeMath.sol";
import { IERC20 } from "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import { ERC20Mintable } from "openzeppelin-solidity/contracts/token/ERC20/ERC20Mintable.sol";
import { ERC20Burnable } from "openzeppelin-solidity/contracts/token/ERC20/ERC20Burnable.sol";
import { ERC20Detailed } from "openzeppelin-solidity/contracts/token/ERC20/ERC20Detailed.sol";
import { SafeERC20 } from "openzeppelin-solidity/contracts/token/ERC20/SafeERC20.sol";
import { ReentrancyGuard } from "openzeppelin-solidity/contracts/utils/ReentrancyGuard.sol";

import { DSMath } from "coinage-token/contracts/lib/DSMath.sol";

import { SeigManagerI } from "./SeigManagerI.sol";
import { SeigToken } from "./SeigToken.sol";


contract WTON is DSMath, Ownable, ReentrancyGuard, ERC20Mintable, ERC20Burnable, ERC20Detailed, SeigToken {
  using SafeERC20 for IERC20;

  IERC20 public ton;

  constructor (
    IERC20 _ton
  )
    public
    ERC20Detailed("Wrapped TON", "WTON", 27)
  {
    require(ERC20Detailed(address(_ton)).decimals() == 18, "WTON: decimals of TON must be 18");
    ton = _ton;
  }

  //////////////////////
  // Override ERC20 functions
  //////////////////////

  function burnFrom(address account, uint256 amount) public {
    if (isMinter(msg.sender)) {
      _burn(account, amount);
      return;
    }

    super.burnFrom(account, amount);
  }

  //////////////////////
  // Swap functions
  //////////////////////

  /**
   * @dev swap WTON to TON
   */
  function swapToTON(uint256 wtonAmount) public nonReentrant returns (bool) {
    return _swapToTON(msg.sender, wtonAmount);
  }

  /**
   * @dev swap TON to WTON
   */
  function swapFromTON(uint256 tonAmount) public nonReentrant returns (bool) {
    return _swapFromTON(msg.sender, tonAmount);
  }

  /**
   * @dev swap WTON to TON, and transfer TON
   * NOTE: TON's transfer event's `from` argument is not `msg.sender` but `WTON` address.
   */
  function swapToTONAndTransfer(address to, uint256 wtonAmount) public nonReentrant returns (bool) {
    return _swapToTON(to, wtonAmount);
  }

  /**
   * @dev swap TON to WTON, and transfer WTON
   */
  function swapFromTONAndTransfer(address to, uint256 tonAmount) public nonReentrant returns (bool) {
    return _swapFromTON(to, tonAmount);
  }

  //////////////////////
  // Internal functions
  //////////////////////

  function _swapToTON(address to, uint256 wtonAmount) internal returns (bool) {
    _burn(msg.sender, wtonAmount);
    ton.safeTransfer(to, _toWAD(wtonAmount));
    return true;
  }

  function _swapFromTON(address to, uint256 tonAmount) internal returns (bool) {
    _mint(to, _toRAY(tonAmount));
    ton.safeTransferFrom(msg.sender, address(this), tonAmount);
    return true;
  }

  /**
   * @dev transform WAD to RAY
   */
  function _toRAY(uint256 v) internal pure returns (uint256) {
    return v * 10 ** 9;
  }

  /**
   * @dev transform RAY to WAD
   */
  function _toWAD(uint256 v) internal pure returns (uint256) {
    if (v % 10 ** 9 != 0) {
      revert("WAD: precision broken");
    }

    return v / 10 ** 9;
  }
}