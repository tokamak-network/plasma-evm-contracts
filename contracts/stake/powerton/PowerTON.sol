pragma solidity ^0.5.12;
pragma experimental ABIEncoderV2;


import { Ownable } from "@openzeppelin/contracts/ownership/Ownable.sol";
import { Pausable } from "@openzeppelin/contracts/lifecycle/Pausable.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

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
    uint64  startTime;
    uint64  endTime;
    uint256 reward;
    address winner;
  }

  // contracts
  address internal _seigManager;
  address internal _wton;

  // rounds
  uint256 internal _currentRound;
  // TODO: consider block nubmer
  uint256 internal _roundDuration; // unix timestamp
  mapping(uint256 => Round) public rounds;

  // sortition
  SortitionSumTreeFactory.SortitionSumTrees internal sortitionSumTrees;
  bool public initialized;

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
    if (currentRoundFinished()) {
      _endRound();
    }
    _;
  }

  //////////////////////////////
  // Events
  //////////////////////////////

  event RoundStart(uint256 round, uint256 startTime, uint256 endTime);
  event RoundEnd(uint256 round, address winner, uint256 reward);
  event PowerIncreased(address indexed account, uint256 amount);
  event PowerDecreased(address indexed account, uint256 amount);

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

  function init() external onlyOwner {
    require(!initialized);
    sortitionSumTrees.createTree(TREE_KEY, TREE_NUM_CHILDREN);
    initialized = true;
  }

  function start() external onlyOwner {
    require(_currentRound == 0, "PowerTON: current round is not zero");
    require(rounds[_currentRound].startTime == 0 && rounds[_currentRound].endTime == 0, "PowerTON: round already started");
    _startRound(0);
  }

  function powerOf(address account) external view returns (uint256) {
    return sortitionSumTrees.stakeOf(TREE_KEY, _getID(account));
  }

  /**
   * @dev end current round
   */
  function endRound() external {
    require(currentRoundFinished(), "PowerTON: round not finished");
    _endRound();
  }

  function roundStarted(uint256 round) public view returns (bool) {
    return rounds[round].startTime != 0 && rounds[round].endTime != 0;
  }

  function roundFinished(uint256 round) public view returns (bool) {
    return roundStarted(round) &&
      rounds[round].endTime < block.timestamp &&
      rounds[round].winner == address(0);
  }

  function currentRoundFinished() public view returns (bool) {
    return roundFinished(_currentRound);
  }

  function _endRound() internal {
    // short circuit in case of no deposit
    if (_totalDeposits == 0) {
      return;
    }

    uint256 round = _currentRound;
    Round storage r = rounds[round];

    uint256 n = _seed(block.number - 1) % _totalDeposits;
    address winner = _recoverID(sortitionSumTrees.draw(TREE_KEY, n));
    require(winner != address(0), "PowerTON: no winner");
    r.winner = winner;


    uint256 reward = IERC20(_wton).balanceOf(address(this));

    r.reward = reward;

    emit RoundEnd(round, winner, reward);

    _currentRound += 1;
    _startRound(_currentRound);

    WTON(_wton).swapToTONAndTransfer(winner, reward);
  }

  //////////////////////////////
  // SeigManager
  //////////////////////////////

  function onDeposit(
    address layer2,
    address account,
    uint256 amount
  ) external checkRound {
    require(msg.sender == _seigManager);
    _increaseEffectiveBalance(account, amount);
    _totalDeposits = _totalDeposits.add(amount);

    emit PowerIncreased(account, amount);
  }

  function onWithdraw(
    address layer2,
    address account,
    uint256 amount
  ) external checkRound {
    require(msg.sender == _seigManager);
    uint256 v = _decreaseEffectiveBalance(account, amount);
    _totalDeposits = _totalDeposits.sub(v);
    emit PowerDecreased(account, v);
  }

  //////////////////////////////
  // External storage getters
  //////////////////////////////

  function seigManager() external view returns (address) { return _seigManager; }
  function wton() external view returns (address) { return _wton; }
  function currentRound() external view returns (uint256) { return _currentRound; }
  function roundDuration() external view returns (uint256) { return _roundDuration; }
  function totalDeposits() external view returns (uint256) { return _totalDeposits; }
  function winnerOf(uint256 round) external view returns (address) {
    return rounds[round].winner;
  }

  //////////////////////////////
  // Internal functions
  //////////////////////////////

  // TODO: enable upgradability
  // TODO: use other entrophy source
  // https://github.com/cryptocopycats/awesome-cryptokitties/blob/master/contracts/GeneScience.sol#L111-L133
  function _seed(uint256 _targetBlock) internal view returns (uint256 randomN) {
    uint256 h = uint256(blockhash(_targetBlock));

    if (h == 0) {
      _targetBlock = (block.number & maskFirst248Bits) + (_targetBlock & maskLast8Bits);
      if (_targetBlock >= block.number) _targetBlock -= 256;

      h = uint256(blockhash(_targetBlock));
    }

    randomN = (h + block.number + uint256(blockhash(block.number - 1))) * h * h * _totalDeposits;
  }

  function _startRound(uint256 round) internal {
    require(
      round == 0 ||
      (rounds[round - 1].endTime < block.timestamp
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

  function _increaseEffectiveBalance(address account, uint256 amount) internal {
    bytes32 id = _getID(account);
    uint256 value = sortitionSumTrees.stakeOf(TREE_KEY, id).add(amount);

    sortitionSumTrees.set(TREE_KEY, value, id);
  }

  function _decreaseEffectiveBalance(address account, uint256 amount) internal returns (uint256) {
    bytes32 id = _getID(account);

    uint256 stake = sortitionSumTrees.stakeOf(TREE_KEY, id);
    uint256 value = _sub0(stake, amount);

    sortitionSumTrees.set(TREE_KEY, value, id);
    return stake - value;
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
