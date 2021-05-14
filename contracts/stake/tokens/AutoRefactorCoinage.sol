// based on ERC20 implementation of openzeppelin/-solidity: https://github.com/OpenZeppelin/openzeppelin/-contracts/blob/7552af95e4ec6fccd64a95b206f59a1b4ff91517/contracts/token/ERC20/ERC20.sol
pragma solidity ^0.5.12;

import { AutoRefactorCoinageI } from "../interfaces/AutoRefactorCoinageI.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";
import { Context } from "@openzeppelin/contracts/GSN/Context.sol";
import { Ownable } from "@openzeppelin/contracts/ownership/Ownable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ERC20Detailed } from "@openzeppelin/contracts/token/ERC20/ERC20Detailed.sol";
import { ERC20Mintable } from "@openzeppelin/contracts/token/ERC20/ERC20Mintable.sol";
import { ERC20Burnable } from "@openzeppelin/contracts/token/ERC20/ERC20Burnable.sol";

import { DSMath } from "../../lib/DSMath.sol";


/**
 * @dev Implementation of coin age token based on ERC20 of openzeppelin/-solidity
 *
 * AutoRefactorCoinage stores `_totalSupply` and `_balances` as RAY BASED value,
 * `_allowances` as RAY FACTORED value.
 *
 * This takes public function (including _approve) parameters as RAY FACTORED value
 * and internal function (including approve) parameters as RAY BASED value, and emits event in RAY FACTORED value.
 *
 * `RAY BASED` = `RAY FACTORED`  / factor
 *
 *  factor increases exponentially for each block mined.
 */
contract AutoRefactorCoinage is Context, IERC20, DSMath, Ownable, ERC20Detailed, ERC20Mintable, ERC20Burnable {
  using SafeMath for uint256;

  struct Balance {
    uint256 balance;
    uint256 refactoredCount;
    uint256 remain;
  }

  uint256 public REFACTOR_BOUNDARY = 10 ** 28;
  uint256 public REFACTOR_DIVIDER = 2;

  uint256 public refactorCount;

  mapping (address => Balance) public balances;

  Balance public _totalSupply;

  uint256 public _factor;

  bool internal _transfersEnabled;

  event FactorSet(uint256 previous, uint256 current, uint256 shiftCount);

  constructor (
    string memory name,
    string memory symbol,
    uint256 factor
  )
    public
    ERC20Detailed(name, symbol, 27)
  {
    _factor = factor;
    //_factorIncrement = factorIncrement;
    //_lastBlock = block.number;
    //_transfersEnabled = transfersEnabled;
  }

  function factor() public view returns (uint256) {
    uint256 result = _factor;
    for (uint256 i = 0; i < refactorCount; i++) {
      result = result.mul(REFACTOR_DIVIDER);
    }
    return result;
  }

  /**
    * @dev See {IERC20-totalSupply}.
    */
  function totalSupply() public view returns (uint256) {
    return _applyFactor(_totalSupply.balance, _totalSupply.refactoredCount).add(_totalSupply.remain);
  }


  /**
    * @dev See {IERC20-balanceOf}.
    */
  function balanceOf(address account) public view returns (uint256) {
    Balance storage b = balances[account];

    return _applyFactor(b.balance, b.refactoredCount).add(b.remain);
  }

  /** @dev Creates `amount` tokens and assigns them to `account`, increasing
    * the total supply.
    *
    * Emits a {Transfer} event with `from` set to the zero address.
    *
    * Requirements
    *
    * - `to` cannot be the zero address.
    */
  function _mint(address account, uint256 amount) internal {
    require(account != address(0), "AutoRefactorCoinage: mint to the zero address");
    Balance storage b = balances[account];

    uint256 currentBalance = balanceOf(account);
    uint256 newBalance = currentBalance.add(amount);

    uint256 rbAmount = _toRAYBased(newBalance);
    b.balance = rbAmount;
    b.refactoredCount = refactorCount;

    addTotalSupply(amount);
    emit Transfer(address(0), account, _toRAYFactored(rbAmount));
  }

    /**
    * @dev Destroys `amount` tokens from `account`, reducing the
    * total supply.
    *
    * Emits a {Transfer} event with `to` set to the zero address.
    *
    * Requirements
    *
    * - `account` cannot be the zero address.
    * - `account` must have at least `amount` tokens.
    */
  function _burn(address account, uint256 amount) internal {
    require(account != address(0), "AutoRefactorCoinage: burn from the zero address");
    Balance storage b = balances[account];

    uint256 currentBalance = balanceOf(account);
    uint256 newBalance = currentBalance.sub(amount);

    uint256 rbAmount = _toRAYBased(newBalance);
    b.balance = rbAmount;
    b.refactoredCount = refactorCount;

    subTotalSupply(amount);
    emit Transfer(account, address(0), _toRAYFactored(rbAmount));
  }

  function _burnFrom(address account, uint256 amount) internal {
    _burn(account, amount);
  }

  // helpers

  /**
   * @param v the value to be factored
   */
  function _applyFactor(uint256 v, uint256 refactoredCount) internal view returns (uint256) {
    if (v == 0) {
      return 0;
    }

    v = rmul2(v, _factor);

    for (uint256 i = refactoredCount; i < refactorCount; i++) {
      v = v.mul(REFACTOR_DIVIDER);
    }

    return v;
  }

  /**
   * @dev Calculate RAY BASED from RAY FACTORED
   */
  function _toRAYBased(uint256 rf) internal view returns (uint256 rb) {
    return rdiv2(rf, _factor);
  }

  /**
   * @dev Calculate RAY FACTORED from RAY BASED
   */
  function _toRAYFactored(uint256 rb) internal view returns (uint256 rf) {
    return rmul2(rb, _factor);
  }


  // new

  function setFactor(uint256 factor) external onlyOwner returns (bool) {
    uint256 previous = _factor;

    uint256 count = 0;
    uint256 f = factor;
    for (; f >= REFACTOR_BOUNDARY; f = f.div(REFACTOR_DIVIDER)) {
      count = count.add(1);
    }

    refactorCount = count;
    _factor = f;
    emit FactorSet(previous, f, count);
  }

  function addTotalSupply(uint256 amount) internal {
    uint256 currentSupply = _applyFactor(_totalSupply.balance, _totalSupply.refactoredCount);
    uint256 newSupply = currentSupply.add(amount);

    uint256 rbAmount = _toRAYBased(newSupply);
    _totalSupply.balance = rbAmount;
    _totalSupply.refactoredCount = refactorCount;
  }

  function subTotalSupply(uint256 amount) internal {
    uint256 currentSupply = _applyFactor(_totalSupply.balance, _totalSupply.refactoredCount);
    uint256 newSupply = currentSupply.sub(amount);

    uint256 rbAmount = _toRAYBased(newSupply);
    _totalSupply.balance = rbAmount;
    _totalSupply.refactoredCount = refactorCount;
  }

  // unsupported functions

  function transfer(address recipient, uint256 amount) public returns (bool) {
    revert();
  }

  function allowance(address owner, address spender) public view returns (uint256) {
    return 0;
  }

  function approve(address spender, uint256 amount) public returns (bool) {
    revert();
  }

  function transferFrom(address sender, address recipient, uint256 amount) public returns (bool) {
    revert();
  }
}
