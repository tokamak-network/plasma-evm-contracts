pragma solidity ^0.5.12;

import { Ownable } from "../../node_modules/openzeppelin-solidity/contracts/ownership/OWnable.sol";
import { SafeMath } from "../../node_modules/openzeppelin-solidity/contracts/math/SafeMath.sol";
import { IERC20 } from "../../node_modules/openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "../../node_modules/openzeppelin-solidity/contracts/token/ERC20/SafeERC20.sol";

import { RootChainI } from "../RootChainI.sol";

import { DepositManagerI } from "./DepositManagerI.sol";
import { RootChainRegistryI } from "./RootChainRegistryI.sol";
import { SeigManagerI } from "./SeigManagerI.sol";

// TODO: add events
// TODO: check deposit/withdraw WTON amount (1e27)

/**
 * @dev DepositManager manages WTON deposit and withdrawal from operator and WTON holders.
 */
contract DepositManager is Ownable {
  using SafeMath for uint256;
  using SafeERC20 for IERC20;

  ////////////////////
  // Storage - contracts
  ////////////////////

  IERC20 internal _wton;
  RootChainRegistryI internal _registry;
  SeigManagerI internal _seigManager;

  ////////////////////
  // Storage - token amount
  ////////////////////

  // accumulated staked amount
  // rootchian => msg.sender => wton amount
  mapping (address => mapping (address => uint256)) internal _accStaked;

  // pending unstaked amount
  // rootchian => msg.sender => wton amount
  mapping (address => mapping (address => uint256)) internal _pendingUnstaked;

  // accumulated unstaked amount
  // rootchian => msg.sender => wton amount
  mapping (address => mapping (address => uint256)) internal _accUnstaked;

  // rootchain => msg.sender => withdrawal requests
  mapping (address => mapping (address => WithdrawalReqeust[])) internal _withdrawalReqeusts;

  // rootchain => msg.sender => index
  mapping (address => mapping (address => uint256)) internal _withdrawalRequestIndex;

  ////////////////////
  // Storage - configuration
  ////////////////////

  // withdrawal delay in block number
  // @TODO: change delay unit to CYCLE?
  uint256 internal _WITHDRAWAL_DELAY;

  struct WithdrawalReqeust {
    uint128 withdrawableBlockNumber;
    uint128 amount;
    bool processed;
  }

  ////////////////////
  // Modifiers
  ////////////////////

  modifier onlyRootChain(address rootchain) {
    require(_registry.rootchains(rootchain));
    _;
  }

  modifier onlySeigManager() {
    require(msg.sender == address(_seigManager));
    _;
  }

  ////////////////////
  // Events
  ////////////////////

  event Deposited(address indexed rootchain, address depositor, uint256 amount);
  event WithdrawalRequested(address indexed rootchain, address depositor, uint256 amount);
  event WithdrawalProcessed(address indexed rootchain, address depositor, uint256 amount);

  ////////////////////
  // Constructor
  ////////////////////

  constructor (
    IERC20 wton,
    RootChainRegistryI registry,
    uint256 WITHDRAWAL_DELAY
  ) public {
    _wton = wton;
    _registry = registry;
    _WITHDRAWAL_DELAY = WITHDRAWAL_DELAY;
  }

  ////////////////////
  // SeiManager function
  ////////////////////

  function setSeigManager(SeigManagerI seigManager) external onlyOwner {
    require(address(_seigManager) == address(0), "DepositManager: SeigManager is already set");
    _seigManager = seigManager;
  }

  ////////////////////
  // Deposit function
  ////////////////////

  /**
   * @dev deposit `amount` WTON in RAY
   */
  function deposit(address rootchain, uint256 amount) external onlyRootChain(rootchain) returns (bool) {
    _accStaked[rootchain][msg.sender] = _accStaked[rootchain][msg.sender].add(amount);

    _wton.safeTransferFrom(msg.sender, address(this), amount);

    emit Deposited(rootchain, msg.sender, amount);

    require(_seigManager.onStake(rootchain, msg.sender, amount));

    return true;
  }

  ////////////////////
  // Withdrawal functions
  ////////////////////

  function requestWithdrawal(address rootchain, uint256 amount) external returns (bool) {
    return _requestWithdrawal(rootchain, amount);
  }

  function _requestWithdrawal(address rootchain, uint256 amount) internal onlyRootChain(rootchain) returns (bool) {
    // TODO: check `amount` WTON can be withdrawable

    _withdrawalReqeusts[rootchain][msg.sender].push(WithdrawalReqeust({
      withdrawableBlockNumber: uint128(block.number + _WITHDRAWAL_DELAY),
      amount: uint128(amount),
      processed: false
    }));

    _pendingUnstaked[rootchain][msg.sender] = _pendingUnstaked[rootchain][msg.sender].add(amount);
    emit WithdrawalRequested(rootchain, msg.sender, amount);

    require(_seigManager.onUnstake(rootchain, msg.sender, amount));

    return true;
  }

  function processRequest(address rootchain) external returns (bool) {
    return _processRequest(rootchain);
  }

  function _processRequest(address rootchain) internal returns (bool) {
    uint256 index = _withdrawalRequestIndex[rootchain][msg.sender];
    require(_withdrawalReqeusts[rootchain][msg.sender].length > index, "DepositManager: no request to process");

    WithdrawalReqeust storage r = _withdrawalReqeusts[rootchain][msg.sender][index];

    require(r.withdrawableBlockNumber <= block.number, "DepositManager: wait for withdrawal delay");
    r.processed = true;

    _withdrawalRequestIndex[rootchain][msg.sender] += 1;

    uint256 amount = r.amount;

    _pendingUnstaked[rootchain][msg.sender] = _pendingUnstaked[rootchain][msg.sender].sub(amount);
    _accUnstaked[rootchain][msg.sender] = _accUnstaked[rootchain][msg.sender].add(amount);

    _wton.safeTransfer(msg.sender, amount);

    emit WithdrawalProcessed(rootchain, msg.sender, amount);
    return true;
  }

  function requestWithdrawalAll(address rootchain) external onlyRootChain(rootchain) returns (bool) {
    uint256 amount = _seigManager.stakeOf(rootchain, msg.sender);

    return _requestWithdrawal(rootchain, amount);
  }

  function processRequests(address rootchain, uint256 n) external returns (bool) {
    for (uint256 i = 0; i < n; i++) {
      _processRequest(rootchain);
    }
    return true;
  }

  function numRequests(address rootchain, address account) external view returns (uint256) {
    return _withdrawalReqeusts[rootchain][account].length;
  }

  function numPendingRequests(address rootchain, address account) external view returns (uint256) {
    uint256 numRequests = _withdrawalReqeusts[rootchain][account].length;
    uint256 index = _withdrawalRequestIndex[rootchain][account];

    if (numRequests == 0) return 0;

    return numRequests - index;
  }

  function _isOperator(address rootchain, address operator) internal view returns (bool) {
    return operator == RootChainI(rootchain).operator();
  }


  ////////////////////
  // Storage getters
  ////////////////////

  function wton() external view returns (IERC20) { return _wton; }
  function registry() external view returns (RootChainRegistryI) { return _registry; }
  function seigManager() external view returns (SeigManagerI) { return _seigManager; }

  function accStaked(address rootchain, address account) external view returns (uint256 wtonAmount) { return _accStaked[rootchain][account]; }
  function pendingUnstaked(address rootchain, address account) external view returns (uint256 wtonAmount) { return _pendingUnstaked[rootchain][account]; }
  function accUnstaked(address rootchain, address account) external view returns (uint256 wtonAmount) { return _accUnstaked[rootchain][account]; }
  function withdrawalRequestIndex(address rootchain, address account) external view returns (uint256 index) { return _withdrawalRequestIndex[rootchain][account]; }

  function WITHDRAWAL_DELAY() external view returns (uint256) { return _WITHDRAWAL_DELAY; }
}