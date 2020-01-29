pragma solidity ^0.5.0;

import { Ownable } from "../../node_modules/openzeppelin-solidity/contracts/ownership/OWnable.sol";
import { SafeMath } from "../../node_modules/openzeppelin-solidity/contracts/math/SafeMath.sol";
import { IERC20 } from "../../node_modules/openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "../../node_modules/openzeppelin-solidity/contracts/token/ERC20/SafeERC20.sol";

import { RootChainI } from "../RootChainI.sol";
import { RootChainRegistry } from "./RootChainRegistry.sol";
import { SeigManager } from "./SeigManager.sol";

// TODO: add events
// TODO: check deposit/withdraw WTON amount (1e27)

/**
 * @dev DepositManager manages WTON deposit and withdrawal from operator and WTON holders.
 */
contract DepositManager is Ownable {
  using SafeMath for uint256;
  using SafeERC20 for IERC20;

  IERC20 public wton;
  RootChainRegistry public registry;
  SeigManager public seigManager;

  // accumulated staked amount
  // rootchian => msg.sender => wton amount
  mapping (address => mapping (address => uint256)) public accStaked;

  // pending unstaked amount
  // rootchian => msg.sender => wton amount
  mapping (address => mapping (address => uint256)) public pendingUnstaked;

  // accumulated unstaked amount
  // rootchian => msg.sender => wton amount
  mapping (address => mapping (address => uint256)) public accUnstaked;

  // rootchain => msg.sender => withdrawal requests
  mapping (address => mapping (address => WithdrawalReqeust[])) public withdrawalReqeusts;

  // rootchain => msg.sender => index
  mapping (address => mapping (address => uint256)) public withdrawalRequestIndex;

  // withdrawal delay in block number
  // @TODO: change delay unit to CYCLE?
  uint256 public WITHDRAWAL_DELAY;

  struct WithdrawalReqeust {
    uint128 withdrawableBlockNumber;
    uint128 amount;
    bool processed;
  }

  modifier onlyRootChain(address rootchain) {
    require(registry.rootchains(rootchain));
    _;
  }

  modifier onlySeigManager() {
    require(msg.sender == address(seigManager));
    _;
  }

  ////////////////////
  // Events
  ////////////////////
  event Deposited(address indexed rootchain, address depositor, uint256 amount);
  event WithdrawalRequested(address indexed rootchain, address depositor, uint256 amount);
  event WithdrawalProcessed(address indexed rootchain, address depositor, uint256 amount);

  constructor (
    IERC20 _wton,
    RootChainRegistry _registry,
    uint256 _WITHDRAWAL_DELAY
  ) public {
    wton = _wton;
    registry = _registry;
    WITHDRAWAL_DELAY = _WITHDRAWAL_DELAY;
  }

  function setSeigManager(SeigManager _seigManager) external onlyOwner {
    require(address(seigManager) == address(0), "DepositManager: SeigManager is already set");
    seigManager = _seigManager;
  }

  /**
   * @dev deposit `amount` WTON in RAY
   */
  function deposit(address rootchain, uint256 amount) public onlyRootChain(rootchain) returns (bool) {
    accStaked[rootchain][msg.sender] = accStaked[rootchain][msg.sender].add(amount);

    wton.safeTransferFrom(msg.sender, address(this), amount);

    emit Deposited(rootchain, msg.sender, amount);

    require(seigManager.onStake(rootchain, msg.sender, amount));

    return true;
  }


  function requestWithdrawal(address rootchain, uint256 amount) public onlyRootChain(rootchain) returns (bool) {
    // TODO: check `amount` WTON can be withdrawable

    withdrawalReqeusts[rootchain][msg.sender].push(WithdrawalReqeust({
      withdrawableBlockNumber: uint128(block.number + WITHDRAWAL_DELAY),
      amount: uint128(amount),
      processed: false
    }));

    pendingUnstaked[rootchain][msg.sender] = pendingUnstaked[rootchain][msg.sender].add(amount);
    emit WithdrawalRequested(rootchain, msg.sender, amount);

    require(seigManager.onUnstake(rootchain, msg.sender, amount));

    return true;
  }

  function processRequest(address rootchain) public returns (bool) {
    uint256 index = withdrawalRequestIndex[rootchain][msg.sender];
    require(withdrawalReqeusts[rootchain][msg.sender].length > index, "DepositManager: no request to process");

    WithdrawalReqeust storage r = withdrawalReqeusts[rootchain][msg.sender][index];

    require(r.withdrawableBlockNumber <= block.number, "DepositManager: wait for withdrawal delay");
    r.processed = true;

    withdrawalRequestIndex[rootchain][msg.sender] += 1;

    uint256 amount = r.amount;

    pendingUnstaked[rootchain][msg.sender] = pendingUnstaked[rootchain][msg.sender].sub(amount);
    accUnstaked[rootchain][msg.sender] = accUnstaked[rootchain][msg.sender].add(amount);

    wton.safeTransfer(msg.sender, amount);

    emit WithdrawalProcessed(rootchain, msg.sender, amount);
    return true;
  }

  function requestWithdrawalAll(address rootchain) external onlyRootChain(rootchain) returns (bool) {
    uint256 amount = seigManager.stakeOf(rootchain, msg.sender);

    return requestWithdrawal(rootchain, amount);
  }

  function processRequests(address rootchain, uint256 n) external returns (bool) {
    for (uint256 i = 0; i < n; i++) {
      processRequest(rootchain);
    }
    return true;
  }

  function numPendingRequests(address rootchain, address account) external view returns (uint256) {
    uint256 numRequests = withdrawalReqeusts[rootchain][msg.sender].length;

    if (numRequests == 0) return 0;

    return numRequests - index;
  }

  function _isOperator(address rootchain, address operator) internal view returns (bool) {
    return operator == RootChainI(rootchain).operator();
  }
}