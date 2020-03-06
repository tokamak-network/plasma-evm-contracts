pragma solidity ^0.5.12;
pragma experimental ABIEncoderV2;


import { Ownable } from "../../../node_modules/openzeppelin-solidity/contracts/ownership/Ownable.sol";
import { Pausable } from "../../../node_modules/openzeppelin-solidity/contracts/lifecycle/Pausable.sol";
import { SafeMath } from "../../../node_modules/openzeppelin-solidity/contracts/math/SafeMath.sol";
import { IERC20 } from "../../../node_modules/openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "../../../node_modules/openzeppelin-solidity/contracts/token/ERC20/SafeERC20.sol";

import { WTON } from "../tokens/WTON.sol";
import { AuthController } from "../tokens/AuthController.sol";

import { SortitionSumTreeFactory } from "../../lib/SortitionSumTreeFactory.sol";

import { DepositManagerI } from "../interfaces/DepositManagerI.sol";
import { PowerTONI } from "../interfaces/PowerTONI.sol";

contract PowerTON is Ownable, Pausable, AuthController, PowerTONI {
  using SafeMath for *;
  using SafeERC20 for IERC20;
  using SortitionSumTreeFactory for SortitionSumTreeFactory.SortitionSumTrees;

  struct Round {
    uint64 startTime;
    uint64 endTime;
    address winner;
  }

  // contracts
  address internal _seigManager;
  address internal _wton;

  // rounds
  uint256 internal _currentRound;
  uint256 internal _roundDuration; // unix timestamp
  mapping(uint256 => Round) public rounds;

  uint256 public constant REWARD_NUMERATOR = 7;
  uint256 public constant REWARD_DENOMINATOR = 10;

  // sortition
  SortitionSumTreeFactory.SortitionSumTrees internal sortitionSumTrees;

  bytes32 constant internal TREE_KEY = keccak256("power-balances");
  bytes32 constant internal TREE_KEY_PREFIX = keccak256("power-balances");
  uint256 constant internal TREE_NUM_CHILDREN = 16;

  // balances
  uint256 internal _totalDeposits;

  // randomness
  uint256 internal constant maskLast8Bits = uint256(0xff);
  uint256 internal constant maskFirst248Bits = uint256(~0xff);


  //////////////////////////////
  // Modifiers
  //////////////////////////////

  modifier checkRound() {
    if (rounds[_currentRound].endTime > block.timestamp) {
      _endRound();
    }
    _;
  }

  //////////////////////////////
  // Events
  //////////////////////////////

  event RoundStart(uint256 round, uint256 startTime, uint256 endTime);
  event RoundEnd(uint256 round, address winner, uint256 reward);

  //////////////////////////////
  // Constructor
  //////////////////////////////

  constructor (
    address seigManager,
    address wton,
    uint256 roundDuration
  ) public {
    require(roundDuration > 0);

    _seigManager = seigManager;
    _wton = wton;
    _roundDuration = roundDuration;
  }

  /**
   * @dev set SeigManager contract, only by owner.
   */
  function setSeigManager(address seigManager) external onlyOwner {
    _seigManager = seigManager;
  }

  function start() external onlyOwner {
    require(_currentRound == 0);
    require(rounds[_currentRound].startTime == 0 && rounds[_currentRound].endTime == 0);
    sortitionSumTrees.createTree(TREE_KEY, TREE_NUM_CHILDREN);
    _startRound(0);
  }

  function powerOf(address account) external returns (uint256) {
    return sortitionSumTrees.stakeOf(TREE_KEY, _getID(account));
  }

  /**
   * @dev join current round
   */
  function endRound() external {
    _endRound();
  }

  function _endRound() internal {
    uint256 round = _currentRound;
    Round storage r = rounds[round];
    _currentRound += 1;

    require(r.endTime > block.timestamp
      && r.winner != address(0),
      "PowerTON: round not finished");

    uint256 n = _seed(block.number - 1) % _totalDeposits;
    address winner = _recoverID(sortitionSumTrees.draw(TREE_KEY, n));
    r.winner = winner;

    uint256 reward = _giveReward(winner);

    emit RoundEnd(round, winner, reward);

    _startRound(_currentRound);
  }

  //////////////////////////////
  // SeigManager
  //////////////////////////////

  function onDeposit(
    address rootchain,
    address account,
    uint256 amount
  ) external checkRound {
    require(msg.sender == _seigManager);
    _increaseEffectiveBalance(account, amount);
    _totalDeposits = _totalDeposits.add(amount);
  }

  function onWithdraw(
    address rootchain,
    address account,
    uint256 amount
  ) external checkRound {
    require(msg.sender == _seigManager);
    uint256 v = _decreaseEffectiveBalance(account, amount);
    _totalDeposits = _totalDeposits.sub(v);
  }

  //////////////////////////////
  // External storage getters
  //////////////////////////////

  function seigManager() external returns (address) { return _seigManager; }
  function wton() external returns (address) { return _wton; }
  function currentRound() external returns (uint256) { return _currentRound; }
  function roundDuration() external returns (uint256) { return _roundDuration; }
  function totalDeposits() external returns (uint256) { return _totalDeposits; }

  //////////////////////////////
  // Internal functions
  //////////////////////////////

  // TODO: use other entrophy source
  // https://github.com/cryptocopycats/awesome-cryptokitties/blob/master/contracts/GeneScience.sol#L111-L133
  function _seed(uint256 _targetBlock) internal returns (uint256 randomN) {
    randomN = uint256(blockhash(_targetBlock));

    if (randomN == 0) {
      _targetBlock = (block.number & maskFirst248Bits) + (_targetBlock & maskLast8Bits);
      if (_targetBlock >= block.number) _targetBlock -= 256;

      randomN = uint256(blockhash(_targetBlock));
    }
  }

  function _startRound(uint256 round) internal {
    require(
      round == 0 ||
      (rounds[round - 1].endTime > block.timestamp
        && rounds[round - 1].winner != address(0))
    );

    Round storage r = rounds[round];
    require(r.startTime == 0 && r.endTime == 0 && r.winner == address(0));

    uint64 startTime = uint64(block.timestamp);
    uint64 endTime = uint64(block.timestamp + _roundDuration);
    r.startTime = startTime;
    r.endTime = endTime;

    emit RoundStart(round, startTime, endTime);
  }

  function _giveReward(address winner) internal returns (uint256 reward) {
    reward = IERC20(_wton).balanceOf(address(this))
      .mul(REWARD_NUMERATOR)
      .div(REWARD_DENOMINATOR);

    WTON(_wton).swapToTONAndTransfer(winner, reward);
  }

  function _increaseEffectiveBalance(address account, uint256 amount) internal {
    bytes32 id = _getID(account);
    uint256 value = sortitionSumTrees.stakeOf(TREE_KEY, id).add(amount);

    sortitionSumTrees.set(TREE_KEY, amount, id);
  }

  function _decreaseEffectiveBalance(address account, uint256 amount) internal returns (uint256) {
    bytes32 id = _getID(account);
    uint256 value = _sub0(sortitionSumTrees.stakeOf(TREE_KEY, id), amount);

    sortitionSumTrees.set(TREE_KEY, amount, id);
    return value;
  }

  /**
   * @dev return a - b if a > b, otherwise 0
   */
  function _sub0(uint256 a, uint256 b) internal pure returns (uint256) {
    if (a > b) return a - b;
    return 0;
  }

  function _getID(address account) internal pure returns (bytes32) {
    return bytes32(uint256(account));
  }

  function _recoverID(bytes32 id) internal pure returns (address) {
    return address(uint160(uint256(id)));
  }

  function _getTreeKey(uint256 round) internal pure returns (bytes32 k) {
    require(round < 2 ** 224);

    k = bytes32(TREE_KEY_PREFIX);
    assembly {
      k := add(k, round)
    }
  }
}