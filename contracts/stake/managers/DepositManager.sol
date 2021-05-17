pragma solidity ^0.5.12;

import { Ownable } from "@openzeppelin/contracts/ownership/Ownable.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import { ERC165 } from "@openzeppelin/contracts/introspection/ERC165.sol";

import { Layer2I } from "../../Layer2I.sol";

import { DepositManagerI } from "../interfaces/DepositManagerI.sol";
import { Layer2RegistryI } from "../interfaces/Layer2RegistryI.sol";
import { SeigManagerI } from "../interfaces/SeigManagerI.sol";
import { WTON } from "../tokens/WTON.sol";
import { OnApprove } from "../tokens/OnApprove.sol";

// TODO: add events
// TODO: check deposit/withdraw WTON amount (1e27)

/**
 * @dev DepositManager manages WTON deposit and withdrawal from operator and WTON holders.
 */
contract DepositManager is Ownable, ERC165, OnApprove {
  using SafeMath for uint256;
  using SafeERC20 for WTON;

  ////////////////////
  // Storage - contracts
  ////////////////////

  WTON internal _wton;
  Layer2RegistryI internal _registry;
  SeigManagerI internal _seigManager;

  ////////////////////
  // Storage - token amount
  ////////////////////

  // accumulated staked amount
  // layer2 => msg.sender => wton amount
  mapping (address => mapping (address => uint256)) internal _accStaked;
  // layer2 => wton amount
  mapping (address => uint256) internal _accStakedLayer2;
  // msg.sender => wton amount
  mapping (address => uint256) internal _accStakedAccount;

  // pending unstaked amount
  // layer2 => msg.sender => wton amount
  mapping (address => mapping (address => uint256)) internal _pendingUnstaked;
  // layer2 => wton amount
  mapping (address => uint256) internal _pendingUnstakedLayer2;
  // msg.sender => wton amount
  mapping (address => uint256) internal _pendingUnstakedAccount;

  // accumulated unstaked amount
  // layer2 => msg.sender => wton amount
  mapping (address => mapping (address => uint256)) internal _accUnstaked;
  // layer2 => wton amount
  mapping (address => uint256) internal _accUnstakedLayer2;
  // msg.sender => wton amount
  mapping (address => uint256) internal _accUnstakedAccount;

  // layer2 => msg.sender => withdrawal requests
  mapping (address => mapping (address => WithdrawalReqeust[])) internal _withdrawalRequests;

  // layer2 => msg.sender => index
  mapping (address => mapping (address => uint256)) internal _withdrawalRequestIndex;

  ////////////////////
  // Storage - configuration / ERC165 interfaces
  ////////////////////

  // withdrawal delay in block number
  // @TODO: change delay unit to CYCLE?
  uint256 public globalWithdrawalDelay;
  mapping (address => uint256) public withdrawalDelay;

  struct WithdrawalReqeust {
    uint128 withdrawableBlockNumber;
    uint128 amount;
    bool processed;
  }

  ////////////////////
  // Modifiers
  ////////////////////

  modifier onlyLayer2(address layer2) {
    require(_registry.layer2s(layer2));
    _;
  }

  modifier onlySeigManager() {
    require(msg.sender == address(_seigManager));
    _;
  }

  ////////////////////
  // Events
  ////////////////////

  event Deposited(address indexed layer2, address depositor, uint256 amount);
  event WithdrawalRequested(address indexed layer2, address depositor, uint256 amount);
  event WithdrawalProcessed(address indexed layer2, address depositor, uint256 amount);

  ////////////////////
  // Constructor
  ////////////////////

  constructor (
    WTON wton,
    Layer2RegistryI registry,
    uint256 globalWithdrawalDelay_
  ) public {
    _wton = wton;
    _registry = registry;
    globalWithdrawalDelay = globalWithdrawalDelay_;
  }

  ////////////////////
  // SeiManager function
  ////////////////////

  function setSeigManager(SeigManagerI seigManager) external onlyOwner {
    _seigManager = seigManager;
  }

  ////////////////////
  // ERC20 Approve callback
  ////////////////////

  function onApprove(
    address owner,
    address spender,
    uint256 amount,
    bytes calldata data
  ) external returns (bool) {
    require(msg.sender == address(_wton), "DepositManager: only accept WTON approve callback");

    address layer2 = _decodeDepositManagerOnApproveData(data);
    require(_deposit(layer2, owner, amount));

    return true;
  }

  function _decodeDepositManagerOnApproveData(
    bytes memory data
  ) internal pure returns (address layer2) {
    require(data.length == 0x20);

    assembly {
      layer2 := mload(add(data, 0x20))
    }
  }

  ////////////////////
  // Deposit function
  ////////////////////

  /**
   * @dev deposit `amount` WTON in RAY
   */

  function deposit(address layer2, uint256 amount) external returns (bool) {
    require(_deposit(layer2, msg.sender, amount));
  }

  function _deposit(address layer2, address account, uint256 amount) internal onlyLayer2(layer2) returns (bool) {
    _accStaked[layer2][account] = _accStaked[layer2][account].add(amount);
    _accStakedLayer2[layer2] = _accStakedLayer2[layer2].add(amount);
    _accStakedAccount[account] = _accStakedAccount[account].add(amount);

    _wton.safeTransferFrom(account, address(this), amount);

    emit Deposited(layer2, account, amount);

    require(_seigManager.onDeposit(layer2, account, amount));

    return true;
  }

  ////////////////////
  // Re-deposit function
  ////////////////////

  /**
   * @dev re-deposit pending requests in the pending queue
   */

  function redeposit(address layer2) external returns (bool) {
    uint256 i = _withdrawalRequestIndex[layer2][msg.sender];
    require(_redeposit(layer2, i, 1));
  }

  function redepositMulti(address layer2, uint256 n) external returns (bool) {
    uint256 i = _withdrawalRequestIndex[layer2][msg.sender];
    require(_redeposit(layer2, i, n));
  }

  function _redeposit(address layer2, uint256 i, uint256 n) internal onlyLayer2(layer2) returns (bool) {
    uint256 accAmount;

    require(_withdrawalRequests[layer2][msg.sender].length > 0, "DepositManager: no request");
    require(_withdrawalRequests[layer2][msg.sender].length - i >= n, "DepositManager: n exceeds num of pending requests");

    uint256 e = i + n;
    for (; i < e; i++) {
      WithdrawalReqeust storage r = _withdrawalRequests[layer2][msg.sender][i];
      uint256 amount = r.amount;

      require(!r.processed, "DepositManager: pending request already processed");
      require(amount > 0, "DepositManager: no valid pending request");

      accAmount = accAmount.add(amount);
      r.processed = true;
    }


    // deposit-related storages
    _accStaked[layer2][msg.sender] = _accStaked[layer2][msg.sender].add(accAmount);
    _accStakedLayer2[layer2] = _accStakedLayer2[layer2].add(accAmount);
    _accStakedAccount[msg.sender] = _accStakedAccount[msg.sender].add(accAmount);

    // withdrawal-related storages
    _pendingUnstaked[layer2][msg.sender] = _pendingUnstaked[layer2][msg.sender].sub(accAmount);
    _pendingUnstakedLayer2[layer2] = _pendingUnstakedLayer2[layer2].sub(accAmount);
    _pendingUnstakedAccount[msg.sender] = _pendingUnstakedAccount[msg.sender].sub(accAmount);

    _withdrawalRequestIndex[layer2][msg.sender] += n;

    emit Deposited(layer2, msg.sender, accAmount);

    require(_seigManager.onDeposit(layer2, msg.sender, accAmount));

    return true;
  }

  ////////////////////
  // Slash functions
  ////////////////////

  function slash(address layer2, address recipient, uint256 amount) external onlySeigManager returns (bool) {
    //return _wton.transferFrom(owner, recipient, amount);
  }

  ////////////////////
  // Setter
  ////////////////////

  function setGlobalWithdrawalDelay(uint256 globalWithdrawalDelay_) external onlyOwner {
    globalWithdrawalDelay = globalWithdrawalDelay_;
  }

  function setWithdrawalDelay(address l2chain, uint256 withdrawalDelay_) external {
    require(_isOperator(l2chain, msg.sender));
    withdrawalDelay[l2chain] = withdrawalDelay_;
  }

  ////////////////////
  // Withdrawal functions
  ////////////////////

  function requestWithdrawal(address layer2, uint256 amount) external returns (bool) {
    return _requestWithdrawal(layer2, amount);
  }

  function _requestWithdrawal(address layer2, uint256 amount) internal onlyLayer2(layer2) returns (bool) {
    require(amount > 0, "DepositManager: amount must not be zero");

    uint256 delay = globalWithdrawalDelay > withdrawalDelay[layer2] ? globalWithdrawalDelay : withdrawalDelay[layer2];
    _withdrawalRequests[layer2][msg.sender].push(WithdrawalReqeust({
      withdrawableBlockNumber: uint128(block.number + delay),
      amount: uint128(amount),
      processed: false
    }));

    _pendingUnstaked[layer2][msg.sender] = _pendingUnstaked[layer2][msg.sender].add(amount);
    _pendingUnstakedLayer2[layer2] = _pendingUnstakedLayer2[layer2].add(amount);
    _pendingUnstakedAccount[msg.sender] = _pendingUnstakedAccount[msg.sender].add(amount);

    emit WithdrawalRequested(layer2, msg.sender, amount);

    require(_seigManager.onWithdraw(layer2, msg.sender, amount));

    return true;
  }

  function processRequest(address layer2, bool receiveTON) external returns (bool) {
    return _processRequest(layer2, receiveTON);
  }

  function _processRequest(address layer2, bool receiveTON) internal returns (bool) {
    uint256 index = _withdrawalRequestIndex[layer2][msg.sender];
    require(_withdrawalRequests[layer2][msg.sender].length > index, "DepositManager: no request to process");

    WithdrawalReqeust storage r = _withdrawalRequests[layer2][msg.sender][index];

    require(r.withdrawableBlockNumber <= block.number, "DepositManager: wait for withdrawal delay");
    r.processed = true;

    _withdrawalRequestIndex[layer2][msg.sender] += 1;

    uint256 amount = r.amount;

    _pendingUnstaked[layer2][msg.sender] = _pendingUnstaked[layer2][msg.sender].sub(amount);
    _pendingUnstakedLayer2[layer2] = _pendingUnstakedLayer2[layer2].sub(amount);
    _pendingUnstakedAccount[msg.sender] = _pendingUnstakedAccount[msg.sender].sub(amount);

    _accUnstaked[layer2][msg.sender] = _accUnstaked[layer2][msg.sender].add(amount);
    _accUnstakedLayer2[layer2] = _accUnstakedLayer2[layer2].add(amount);
    _accUnstakedAccount[msg.sender] = _accUnstakedAccount[msg.sender].add(amount);

    if (receiveTON) {
      require(_wton.swapToTONAndTransfer(msg.sender, amount));
    } else {
      _wton.safeTransfer(msg.sender, amount);
    }

    emit WithdrawalProcessed(layer2, msg.sender, amount);
    return true;
  }

  function requestWithdrawalAll(address layer2) external onlyLayer2(layer2) returns (bool) {
    uint256 amount = _seigManager.stakeOf(layer2, msg.sender);

    return _requestWithdrawal(layer2, amount);
  }

  function processRequests(address layer2, uint256 n, bool receiveTON) external returns (bool) {
    for (uint256 i = 0; i < n; i++) {
      require(_processRequest(layer2, receiveTON));
    }
    return true;
  }

  function numRequests(address layer2, address account) external view returns (uint256) {
    return _withdrawalRequests[layer2][account].length;
  }

  function numPendingRequests(address layer2, address account) external view returns (uint256) {
    uint256 numRequests = _withdrawalRequests[layer2][account].length;
    uint256 index = _withdrawalRequestIndex[layer2][account];

    if (numRequests == 0) return 0;

    return numRequests - index;
  }

  function _isOperator(address layer2, address operator) internal view returns (bool) {
    return operator == Layer2I(layer2).operator();
  }


  ////////////////////
  // Storage getters
  ////////////////////

  // solium-disable
  function wton() external view returns (address) { return address(_wton); }
  function registry() external view returns (address) { return address(_registry); }
  function seigManager() external view returns (address) { return address(_seigManager); }

  function accStaked(address layer2, address account) external view returns (uint256 wtonAmount) { return _accStaked[layer2][account]; }
  function accStakedLayer2(address layer2) external view returns (uint256 wtonAmount) { return _accStakedLayer2[layer2]; }
  function accStakedAccount(address account) external view returns (uint256 wtonAmount) { return _accStakedAccount[account]; }

  function pendingUnstaked(address layer2, address account) external view returns (uint256 wtonAmount) { return _pendingUnstaked[layer2][account]; }
  function pendingUnstakedLayer2(address layer2) external view returns (uint256 wtonAmount) { return _pendingUnstakedLayer2[layer2]; }
  function pendingUnstakedAccount(address account) external view returns (uint256 wtonAmount) { return _pendingUnstakedAccount[account]; }

  function accUnstaked(address layer2, address account) external view returns (uint256 wtonAmount) { return _accUnstaked[layer2][account]; }
  function accUnstakedLayer2(address layer2) external view returns (uint256 wtonAmount) { return _accUnstakedLayer2[layer2]; }
  function accUnstakedAccount(address account) external view returns (uint256 wtonAmount) { return _accUnstakedAccount[account]; }

  function withdrawalRequestIndex(address layer2, address account) external view returns (uint256 index) { return _withdrawalRequestIndex[layer2][account]; }
  function withdrawalRequest(address layer2, address account, uint256 index) external view returns (uint128 withdrawableBlockNumber, uint128 amount, bool processed ) {
    withdrawableBlockNumber = _withdrawalRequests[layer2][account][index].withdrawableBlockNumber;
    amount = _withdrawalRequests[layer2][account][index].amount;
    processed = _withdrawalRequests[layer2][account][index].processed;
  }

  // solium-enable
}
