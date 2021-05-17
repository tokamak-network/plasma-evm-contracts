pragma solidity ^0.5.12;

import { Ownable } from "@openzeppelin/contracts/ownership/Ownable.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ERC20Mintable } from "@openzeppelin/contracts/token/ERC20/ERC20Mintable.sol";
import { ERC20Burnable } from "@openzeppelin/contracts/token/ERC20/ERC20Burnable.sol";
import { ERC20Detailed } from "@openzeppelin/contracts/token/ERC20/ERC20Detailed.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { ERC165 } from "@openzeppelin/contracts/introspection/ERC165.sol";
import { ERC165Checker } from "@openzeppelin/contracts/introspection/ERC165Checker.sol";

// import { DSMath } from "../../../node_modules/coinage-token/contracts/lib/DSMath.sol";

import { SeigManagerI } from "../interfaces/SeigManagerI.sol";

import { SeigToken } from "./SeigToken.sol";
import { OnApprove } from "./OnApprove.sol";


contract WTON is ReentrancyGuard, Ownable, ERC20Mintable, ERC20Burnable, ERC20Detailed, SeigToken, OnApprove {
  using SafeERC20 for ERC20Mintable;

  ERC20Mintable public ton;

  constructor (
    ERC20Mintable _ton
  )
    public
    ERC20Detailed("Wrapped TON", "WTON", 27)
  {
    require(ERC20Detailed(address(_ton)).decimals() == 18, "WTON: decimals of TON must be 18");
    ton = _ton;
  }

  //////////////////////
  // TON Approve callback
  //////////////////////

  function onApprove(
    address owner,
    address spender,
    uint256 tonAmount,
    bytes calldata data
  ) external returns (bool) {
    require(msg.sender == address(ton), "WTON: only accept TON approve callback");

    // swap owner's TON to WTON
    _swapFromTON(owner, owner, tonAmount);

    uint256 wtonAmount = _toRAY(tonAmount);
    (address depositManager, address layer2) = _decodeTONApproveData(data);

    // approve WTON to DepositManager
    _approve(owner, depositManager, wtonAmount);

    // call DepositManager.onApprove to deposit WTON
    bytes memory depositManagerOnApproveData = _encodeDepositManagerOnApproveData(layer2);
    _callOnApprove(owner, depositManager, wtonAmount, depositManagerOnApproveData);

    return true;
  }

  /**
   * @dev data is 64 bytes of 2 addresses in left-padded 32 bytes
   */
  function _decodeTONApproveData(
    bytes memory data
  ) internal pure returns (address depositManager, address layer2) {
    require(data.length == 0x40);

    assembly {
      depositManager := mload(add(data, 0x20))
      layer2 := mload(add(data, 0x40))
    }
  }

  function _encodeDepositManagerOnApproveData(
    address layer2
  ) internal pure returns (bytes memory data) {
    data = new bytes(0x20);

    assembly {
      mstore(add(data, 0x20), layer2)
    }
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
    return _swapToTON(msg.sender, msg.sender, wtonAmount);
  }

  /**
   * @dev swap TON to WTON
   */
  function swapFromTON(uint256 tonAmount) public nonReentrant returns (bool) {
    return _swapFromTON(msg.sender, msg.sender, tonAmount);
  }

  /**
   * @dev swap WTON to TON, and transfer TON
   * NOTE: TON's transfer event's `from` argument is not `msg.sender` but `WTON` address.
   */
  function swapToTONAndTransfer(address to, uint256 wtonAmount) public nonReentrant returns (bool) {
    return _swapToTON(to, msg.sender, wtonAmount);
  }

  /**
   * @dev swap TON to WTON, and transfer WTON
   */
  function swapFromTONAndTransfer(address to, uint256 tonAmount) public nonReentrant returns (bool) {
    return _swapFromTON(msg.sender, to, tonAmount);
  }

  function renounceTonMinter() external onlyOwner {
    ton.renounceMinter();
  }

  //////////////////////
  // Internal functions
  //////////////////////

  function _swapToTON(address tonAccount, address wtonAccount, uint256 wtonAmount) internal returns (bool) {
    _burn(wtonAccount, wtonAmount);

    // mint TON if WTON contract has not enough TON to transfer
    uint256 tonAmount = _toWAD(wtonAmount);
    uint256 tonBalance = ton.balanceOf(address(this));
    if (tonBalance < tonAmount) {
      ton.mint(address(this), tonAmount.sub(tonBalance));
    }

    ton.safeTransfer(tonAccount, tonAmount);
    return true;
  }

  function _swapFromTON(address tonAccount, address wtonAccount, uint256 tonAmount) internal returns (bool) {
    _mint(wtonAccount, _toRAY(tonAmount));
    ton.safeTransferFrom(tonAccount, address(this), tonAmount);
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
    return v / 10 ** 9;
  }
}
