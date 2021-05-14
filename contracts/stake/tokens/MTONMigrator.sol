pragma solidity ^0.5.12;

import { Ownable } from "@openzeppelin/contracts/ownership/Ownable.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";


/**
 * @dev MTONMigrator supports migration MTON from faraday network to ethereum mainnet.
 */
contract MTONMigrator is Ownable {
  using SafeMath for uint256;
  using SafeERC20 for IERC20;

  IERC20 public mton;

  mapping (address => uint256) public balances;
  mapping (address => uint256) public claimed;

  event SetBalance(address indexed account, uint256 amount);
  event TokenClaimed(address indexed account, uint256 amount);

  constructor(IERC20 _mton) public {
    mton = _mton;
  }

  /**
   * Set balances
   */
  function setBalanceMulti(address[] calldata _accounts, uint256[] calldata _amounts) external onlyOwner {
    require(_accounts.length == _amounts.length, "MTONMigrator: parameter length mismatch");

    for (uint256 i = 0; i < _accounts.length; i++) {
      _setBalance(_accounts[i], _amounts[i]);
    }
  }

  function setBalance(address _account, uint256 _amount) public onlyOwner {
    _setBalance(_account, _amount);
  }

  function _setBalance(address _account, uint256 _amount) internal {
    require(balances[_account] == 0, "MTONMigrator: balances already set");
    balances[_account] = _amount;
    emit SetBalance(_account, _amount);
  }

  /**
   * Reset balances
   */
  function resetBalanceMulti(address[] calldata _accounts) external onlyOwner {
    for (uint256 i = 0; i < _accounts.length; i++) {
      _resetBalance(_accounts[i]);
    }
  }

  function resetBalance(address _account) public onlyOwner {
    _resetBalance(_account);
  }

  function _resetBalance(address _account) internal {
    // require(balances[_account] > 0, "MTONMigrator: balances not set");
    balances[_account] = 0;
    emit SetBalance(_account, 0);
  }

  function claimable(address _account) public view returns (uint256) {
    return balances[_account].sub(claimed[_account]);
  }

  /**
   * Claim tokens
   */
  function claimAll() external {
    claim(claimable(msg.sender));
  }

  function claim(uint256 _amount) public {
    uint256 v = claimed[msg.sender].add(_amount);

    require(balances[msg.sender] >= v, "MTONMigrator: amount exceeds balances");

    claimed[msg.sender] = v;

    mton.safeTransfer(msg.sender, _amount);

    emit TokenClaimed(msg.sender, _amount);
  }
}