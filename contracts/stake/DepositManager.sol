pragma solidity ^0.5.0;

import { Ownable } from "openzeppelin-solidity/contracts/ownership/OWnable.sol";
import { SafeMath } from "openzeppelin-solidity/contracts/math/SafeMath.sol";
import { IERC20 } from "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "openzeppelin-solidity/contracts/token/ERC20/SafeERC20.sol";

import { RootChainI } from "../RootChainI.sol";
import { RootChainRegistry } from "./RootChainRegistry.sol";
import { SeigManager } from "./SeigManager.sol";

// TODO: add events

/**
 * @dev DepositManager manages TON deposit and withdrawal from operator and TON holders.
 */
contract DepositManager is Ownable {
  using SafeMath for uint256;
  using SafeERC20 for IERC20;

  IERC20 public ton;
  RootChainRegistry public registry;
  SeigManager public seigManager;

  // rootchian => msg.sender => ton amount
  mapping (address => mapping (address => uint256)) public deposits;

  // rootchain => msg.sender => withdrawal requests
  mapping (address => mapping (address => WithdrawalReqeust[])) public withdrawalReqeusts;

  // rootchain => msg.sender => index
  mapping (address => mapping (address => uint256)) public withdrawalRequestIndex;

  // withdrawal delay in unix timestamp
  // @TODO: change delay unit to CYCLE?
  uint256 public WITHDRAWAL_DELAY;

  struct WithdrawalReqeust {
    uint128 withdrawableAt;
    uint128 amount;
    bool processed;
  }

  modifier onlyRootChain(address rootchain) {
    require(registry.rootchains(rootchain));
    _;
  }

  constructor (
    IERC20 _ton,
    RootChainRegistry _registry,
    uint256 _WITHDRAWAL_DELAY
  ) public {
    ton = _ton;
    registry = _registry;
    WITHDRAWAL_DELAY = _WITHDRAWAL_DELAY;
  }

  function setSeigManager(SeigManager _seigManager) external onlyOwner {
    seigManager = _seigManager;
  }

  function deposit(address rootchain, uint256 amount) external onlyRootChain(rootchain) returns (bool) {
    deposits[rootchain][msg.sender] = deposits[rootchain][msg.sender].add(amount);

    ton.safeTransferFrom(msg.sender, address(this), amount);

    return true;
  }

  function requestWithdrawal(address rootchain, uint256 amount) external onlyRootChain(rootchain) returns (bool) {
    deposits[rootchain][msg.sender] = deposits[rootchain][msg.sender].sub(amount);

    withdrawalReqeusts[rootchain][msg.sender].push(WithdrawalReqeust({
      withdrawableAt: uint128(block.timestamp + WITHDRAWAL_DELAY),
      amount: uint128(amount),
      processed: false
    }));
  }

  function processRequest(address rootchain) public {
    uint256 index = withdrawalRequestIndex[rootchain][msg.sender];

    WithdrawalReqeust storage r = withdrawalReqeusts[rootchain][msg.sender][index];

    require(r.withdrawableAt >= block.timestamp);
    r.processed = true;

    withdrawalRequestIndex[rootchain][msg.sender] += 1;

    ton.safeTransfer(msg.sender, r.amount);
  }

  function processRequests(address rootchain, uint256 n) external {
    for (uint256 i = 0; i < n; i++) {
      processRequest(rootchain);
    }
  }

  function _isOperator(address rootchain, address operator) internal view returns (bool) {
    return operator == RootChainI(rootchain).operator();
  }
}