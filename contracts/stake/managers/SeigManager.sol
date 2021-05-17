pragma solidity ^0.5.12;

import { Ownable } from "@openzeppelin/contracts/ownership/Ownable.sol";
import { Pausable } from "@openzeppelin/contracts/lifecycle/Pausable.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";
import { ERC20Mintable } from "@openzeppelin/contracts/token/ERC20/ERC20Mintable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

import { DSMath } from "../../lib/DSMath.sol";
//import { CustomIncrementCoinageMock } from "@coinage-token/flatten.sol";
//import { AutoRefactorCoinage } from "@coinage-token/flatten.sol";
//import { AutoRefactorCoinage } from "../tokens/AutoRefactorCoinage.sol";
import { AutoRefactorCoinageI } from "../interfaces/AutoRefactorCoinageI.sol";
import { CoinageFactoryI } from "../interfaces/CoinageFactoryI.sol";

import { AuthController } from "../tokens/AuthController.sol";
import { ChallengerRole } from "../../roles/ChallengerRole.sol";

import { Layer2I } from "../../Layer2I.sol";

import { SeigManagerI } from "../interfaces/SeigManagerI.sol";
import { Layer2RegistryI } from "../interfaces/Layer2RegistryI.sol";
import { DepositManagerI } from "../interfaces/DepositManagerI.sol";
import { PowerTONI } from "../interfaces/PowerTONI.sol";



/**
 * @dev SeigManager gives seigniorage to operator and WTON holders.
 * For each commit by operator, operator (or user) will get seigniorage
 * in propotion to the staked (or delegated) amount of WTON.
 *
 * [Tokens]
 * - {tot} tracks total staked or delegated WTON of each Layer2 contract (and depositor?).
 * - {coinages[layer2]} tracks staked or delegated WTON of user or operator to a Layer2 contract.
 *
 * For each commit by operator,
 *  1. increases all layer2's balance of {tot} by (the staked amount of WTON) /
 *     (total supply of TON and WTON) * (num blocks * seigniorage per block).
 *  2. increases all depositors' blanace of {coinages[layer2]} in proportion to the staked amount of WTON,
 *     up to the increased amount in step (1).
 *  3. set the layer2's balance of {committed} as the layer2's {tot} balance.
 *
 * For each stake or delegate with amount of {v} to a Layer2,
 *  1. mint {v} {coinages[layer2]} tokens to the account
 *  2. mint {v} {tot} tokens to the layer2 contract
 *
 * For each unstake or undelegate (or get rewards) with amount of {v} to a Layer2,
 *  1. burn {v} {coinages[layer2]} tokens from the account
 *  2. burn {v + ⍺} {tot} tokens from the layer2 contract,
 *   where ⍺ = SEIGS * staked ratio of the layer2 * withdrawal ratio of the account
 *     - SEIGS                              = tot total supply - tot total supply at last commit from the layer2
 *     - staked ratio of the layer2     = tot balance of the layer2 / tot total supply
 *     - withdrawal ratio of the account  = amount to withdraw / total supply of coinage
 *
 */
contract SeigManager is SeigManagerI, DSMath, Ownable, Pausable, AuthController, ChallengerRole {
  using SafeMath for uint256;
  using SafeERC20 for ERC20Mintable;

  //////////////////////////////
  // Common contracts
  //////////////////////////////

  Layer2RegistryI internal _registry;
  DepositManagerI internal _depositManager;
  PowerTONI internal _powerton;
  address public dao;

  //////////////////////////////
  // Token-related
  //////////////////////////////

  // TON token contract
  IERC20 internal _ton;

  // WTON token contract
  ERC20Mintable internal _wton; // TODO: use mintable erc20!

  // contract factory
  CoinageFactoryI public factory;

  // track total deposits of each layer2.
  AutoRefactorCoinageI internal _tot;

  // coinage token for each layer2.
  mapping (address => AutoRefactorCoinageI) internal _coinages;

  // last commit block number for each layer2.
  mapping (address => uint256) internal _lastCommitBlock;

  // total seigniorage per block
  uint256 internal _seigPerBlock;

  // the block number when seigniorages are given
  uint256 internal _lastSeigBlock;

  // block number when paused or unpaused
  uint256 internal _pausedBlock;
  uint256 internal _unpausedBlock;

  // commission rates in RAY
  mapping (address => uint256) internal _commissionRates;

  // whether commission is negative or not (default=possitive)
  mapping (address => bool) internal _isCommissionRateNegative;

  // setting commissionrate delay
  uint256 public adjustCommissionDelay;
  mapping (address => uint256) public delayedCommissionBlock;
  mapping (address => uint256) public delayedCommissionRate;
  mapping (address => bool) public delayedCommissionRateNegative;

  // minimum deposit amount
  uint256 public minimumAmount;

  uint256 public powerTONSeigRate;
  uint256 public daoSeigRate;
  uint256 public relativeSeigRate;

  uint256 public accRelativeSeig;

  //////////////////////////////
  // Constants
  //////////////////////////////

  uint256 constant public RAY = 10 ** 27; // 1 RAY
  uint256 constant internal _DEFAULT_FACTOR = RAY;

  uint256 constant public MAX_VALID_COMMISSION = RAY; // 1 RAY
  uint256 constant public MIN_VALID_COMMISSION = 10 ** 25; // 0.01 RAY

  //////////////////////////////
  // Modifiers
  //////////////////////////////

  modifier onlyRegistry() {
    require(msg.sender == address(_registry));
    _;
  }

  modifier onlyRegistryOrOperator(address layer2) {
    require(msg.sender == address(_registry) || msg.sender == Layer2I(layer2).operator());
    _;
  }

  modifier onlyDepositManager() {
    require(msg.sender == address(_depositManager));
    _;
  }

  modifier onlyLayer2(address layer2) {
    require(_registry.layer2s(layer2));
    _;
  }

  modifier checkCoinage(address layer2) {
    require(address(_coinages[layer2]) != address(0), "SeigManager: coinage has not been deployed yet");
    _;
  }

  //////////////////////////////
  // Events
  //////////////////////////////

  event CoinageCreated(address indexed layer2, address coinage);
  event SeigGiven(address indexed layer2, uint256 totalSeig, uint256 stakedSeig, uint256 unstakedSeig, uint256 powertonSeig, uint256 pseig);
  event Comitted(address indexed layer2);
  event CommissionRateSet(address indexed layer2, uint256 previousRate, uint256 newRate);

  //////////////////////////////
  // Constuctor
  //////////////////////////////

  constructor (
    ERC20Mintable ton,
    ERC20Mintable wton,
    Layer2RegistryI registry,
    DepositManagerI depositManager,
    uint256 seigPerBlock,
    address factory_
  ) public {
    _ton = ton;
    _wton = wton;
    _registry = registry;
    _depositManager = depositManager;
    _seigPerBlock = seigPerBlock;

    factory = CoinageFactoryI(factory_);
    address c = factory.deploy();
    _tot = AutoRefactorCoinageI(c);

    _lastSeigBlock = block.number;
  }

  //////////////////////////////
  // Override Pausable
  //////////////////////////////

  function pause() public onlyPauser whenNotPaused {
    _pausedBlock = block.number;
    super.pause();
  }

  /**
   * @dev Called by a pauser to unpause, returns to normal state.
   */
  function unpause() public onlyPauser whenPaused {
    _unpausedBlock = block.number;
    super.unpause();
  }

  //////////////////////////////
  // External functions
  //////////////////////////////

  /**
   * @dev set PowerTON contract, only by owner.
   */
  function setPowerTON(PowerTONI powerton) external onlyOwner {
    _powerton = powerton;
  }

  function setDao(address daoAddress) external onlyOwner {
    dao = daoAddress;
  }

  /**
   * @dev deploy coinage token for the layer2.
   */
  function deployCoinage(address layer2) external onlyRegistry returns (bool) {
    // create new coinage token for the layer2 contract
    if (address(_coinages[layer2]) == address(0)) {
      address c = factory.deploy();
      _lastCommitBlock[layer2] = block.number;
      addChallenger(layer2);
      _coinages[layer2] = AutoRefactorCoinageI(c);
      emit CoinageCreated(layer2, c);
    }

    return true;
  }

  function setCommissionRate(
    address layer2,
    uint256 commissionRate,
    bool isCommissionRateNegative
  )
    external
    onlyRegistryOrOperator(layer2)
    returns (bool)
  {
    // check commission range
    require(
      (commissionRate == 0) ||
      (MIN_VALID_COMMISSION <= commissionRate && commissionRate <= MAX_VALID_COMMISSION),
      "SeigManager: commission rate must be 0 or between 1 RAY and 0.01 RAY"
    );

    uint256 previous = _commissionRates[layer2];
    if (adjustCommissionDelay == 0) {
      _commissionRates[layer2] = commissionRate;
      _isCommissionRateNegative[layer2] = isCommissionRateNegative;
    } else {
      delayedCommissionBlock[layer2] = block.number + adjustCommissionDelay;
      delayedCommissionRate[layer2] = commissionRate;
      delayedCommissionRateNegative[layer2] = isCommissionRateNegative;
    }

    emit CommissionRateSet(layer2, previous, commissionRate);

    return true;
  }

  function getOperatorAmount(address layer2) public view returns (uint256) {
    address operator = Layer2I(msg.sender).operator();
    return _coinages[layer2].balanceOf(operator);
  }

  /**
   * @dev Callback for a new commit
   */
  function updateSeigniorage()
    external
    checkCoinage(msg.sender)
    returns (bool)
  {
    // short circuit if paused
    if (paused()) {
      return true;
    }

    uint256 operatorAmount = getOperatorAmount(msg.sender);
    require(operatorAmount >= minimumAmount);

    _increaseTot();

    _lastCommitBlock[msg.sender] = block.number;

    // 2. increase total supply of {coinages[layer2]}
    AutoRefactorCoinageI coinage = _coinages[msg.sender];

    uint256 prevTotalSupply = coinage.totalSupply();
    uint256 nextTotalSupply = _tot.balanceOf(msg.sender);

    // short circuit if there is no seigs for the layer2
    if (prevTotalSupply >= nextTotalSupply) {
      emit Comitted(msg.sender);
      return true;
    }

    uint256 seigs = nextTotalSupply - prevTotalSupply;
    address operator = Layer2I(msg.sender).operator();
    uint256 operatorSeigs;

    // calculate commission amount
    bool isCommissionRateNegative = _isCommissionRateNegative[msg.sender];

    (nextTotalSupply, operatorSeigs) = _calcSeigsDistribution(
      msg.sender,
      coinage,
      prevTotalSupply,
      seigs,
      isCommissionRateNegative,
      operator
    );

    // gives seigniorages to the layer2 as coinage
    coinage.setFactor(
      _calcNewFactor(
        prevTotalSupply,
        nextTotalSupply,
        coinage.factor()
      )
    );

    // give commission to operator or delegators
    if (operatorSeigs != 0) {
      if (isCommissionRateNegative) {
        // TODO: adjust arithmetic error
        // burn by 𝜸
        coinage.burnFrom(operator, operatorSeigs);
      } else {
        coinage.mint(operator, operatorSeigs);
      }
    }

    _wton.mint(address(_depositManager), seigs);

    emit Comitted(msg.sender);

    return true;
  }

  function _calcSeigsDistribution(
    address layer2,
    AutoRefactorCoinageI coinage,
    uint256 prevTotalSupply,
    uint256 seigs,
    bool isCommissionRateNegative,
    address operator
  ) internal returns (
    uint256 nextTotalSupply,
    uint256 operatorSeigs
  ) {
    if (block.number >= delayedCommissionBlock[layer2] && delayedCommissionBlock[layer2] != 0) {
      _commissionRates[layer2] = delayedCommissionRate[layer2];
      _isCommissionRateNegative[layer2] = delayedCommissionRateNegative[layer2];
      delayedCommissionBlock[layer2] = 0;
    }

    uint256 commissionRate = _commissionRates[msg.sender];

    nextTotalSupply = prevTotalSupply + seigs;

    // short circuit if there is no commission rate
    if (commissionRate == 0) {
      return (nextTotalSupply, operatorSeigs);
    }

    // if commission rate is possitive
    if (!isCommissionRateNegative) {
      operatorSeigs = rmul(seigs, commissionRate); // additional seig for operator
      nextTotalSupply = nextTotalSupply.sub(operatorSeigs);
      return (nextTotalSupply, operatorSeigs);
    }

    // short circuit if there is no previous total deposit (meanning, there is no deposit)
    if (prevTotalSupply == 0) {
      return (nextTotalSupply, operatorSeigs);
    }

    // See negative commission distribution formular here: TBD
    uint256 operatorBalance = coinage.balanceOf(operator);

    // short circuit if there is no operator deposit
    if (operatorBalance == 0) {
      return (nextTotalSupply, operatorSeigs);
    }

    uint256 operatorRate = rdiv(operatorBalance, prevTotalSupply);

    // ɑ: insufficient seig for operator
    operatorSeigs = rmul(
      rmul(seigs, operatorRate), // seigs for operator
      commissionRate
    );

    // β:
    uint256 delegatorSeigs = operatorRate == RAY
      ? operatorSeigs
      : rdiv(operatorSeigs, RAY - operatorRate);

    // 𝜸:
    operatorSeigs = operatorRate == RAY
      ? operatorSeigs
      : operatorSeigs + rmul(delegatorSeigs, operatorRate);

    nextTotalSupply = nextTotalSupply.add(delegatorSeigs);

    return (nextTotalSupply, operatorSeigs);
  }

  /**
   * @dev Callback for a token transfer
   */
  function onTransfer(address sender, address recipient, uint256 amount) external returns (bool) {
    require(msg.sender == address(_ton) || msg.sender == address(_wton),
      "SeigManager: only TON or WTON can call onTransfer");

    if (!paused()) {
      _increaseTot();
    }

    return true;
  }

  /**
   * @dev Callback for a new deposit
   */
  function onDeposit(address layer2, address account, uint256 amount)
    external
    onlyDepositManager
    checkCoinage(layer2)
    returns (bool)
  {
    if (_isOperator(layer2, account)) {
      uint256 newAmount = _coinages[layer2].balanceOf(account).add(amount);
      require(newAmount >= minimumAmount, "minimum amount is required");
    }
    _tot.mint(layer2, amount);
    _coinages[layer2].mint(account, amount);
    if (address(_powerton) != address(0)) {
      _powerton.onDeposit(layer2, account, amount);
    }
    return true;
  }

  // DEV ONLY
  event UnstakeLog(uint coinageBurnAmount, uint totBurnAmount);

  function onWithdraw(address layer2, address account, uint256 amount)
    external
    onlyDepositManager
    checkCoinage(layer2)
    returns (bool)
  {
    require(_coinages[layer2].balanceOf(account) >= amount, "SeigManager: insufficiant balance to unstake");

    if (_isOperator(layer2, account)) {
      uint256 newAmount = _coinages[layer2].balanceOf(account).sub(amount);
      require(newAmount >= minimumAmount, "minimum amount is required");
    }

    // burn {v + ⍺} {tot} tokens to the layer2 contract,
    uint256 totAmount = _additionalTotBurnAmount(layer2, account, amount);
    _tot.burnFrom(layer2, amount.add(totAmount));

    // burn {v} {coinages[layer2]} tokens to the account
    _coinages[layer2].burnFrom(account, amount);

    if (address(_powerton) != address(0)) {
      _powerton.onWithdraw(layer2, account, amount);
    }

    emit UnstakeLog(amount, totAmount);

    return true;
  }

  function setPowerTONSeigRate(uint256 powerTONSeigRate_) external onlyOwner {
    require(powerTONSeigRate_ > 0 && powerTONSeigRate_ < RAY, "exceeded seigniorage rate");
    powerTONSeigRate = powerTONSeigRate_;
  }

  function setDaoSeigRate(uint256 daoSeigRate_) external onlyOwner {
    require(daoSeigRate_ > 0 && daoSeigRate_ < RAY, "exceeded seigniorage rate");
    daoSeigRate = daoSeigRate_;
  }

  function setPseigRate(uint256 PseigRate_) external onlyOwner {
    require(PseigRate_ > 0 && PseigRate_ < RAY, "exceeded seigniorage rate");
    relativeSeigRate = PseigRate_;
  }

  function setCoinageFactory(address factory_) external onlyOwner {
    factory = CoinageFactoryI(factory_);
  }

  function addChallenger(address account) public onlyRegistry {
    _addChallenger(account);
  }

  function transferCoinageOwnership(address newSeigManager, address[] calldata coinages) external onlyOwner {
    for (uint256 i = 0; i < coinages.length; i++) {
      AutoRefactorCoinageI c = AutoRefactorCoinageI(coinages[i]);
      c.addMinter(newSeigManager);
      c.renounceMinter();
      c.transferOwnership(newSeigManager);
    }
  }

  function renounceWTONMinter() external onlyOwner {
    _wton.renounceMinter();
  }

  function slash(address layer2, address challenger) external onlyChallenger checkCoinage(layer2) returns (bool) {
    Layer2I(layer2).changeOperator(challenger);

    return true;
  }

  function additionalTotBurnAmount(address layer2, address account, uint256 amount)
    external
    view
    returns (uint256 totAmount)
  {
    return _additionalTotBurnAmount(layer2, account, amount);
  }

  // return ⍺, where ⍺ = (tot.balanceOf(layer2) - coinages[layer2].totalSupply()) * (amount / coinages[layer2].totalSupply())
  function _additionalTotBurnAmount(address layer2, address account, uint256 amount)
    internal
    view
    returns (uint256 totAmount)
  {
    uint256 coinageTotalSupply = _coinages[layer2].totalSupply();
    uint256 totBalalnce = _tot.balanceOf(layer2);

    // NOTE: arithamtic operations (mul and div) make some errors, so we gonna adjust them under 1e-9 WTON.
    //       note that coinageTotalSupply and totBalalnce are RAY values.
    if (coinageTotalSupply > totBalalnce && coinageTotalSupply - totBalalnce < WAD) {
      return 0;
    }

    return rdiv(
      rmul(
        totBalalnce.sub(coinageTotalSupply),
        amount
      ),
      coinageTotalSupply
    );
  }

  function setAdjustDelay(uint256 adjustDelay_) external onlyOwner {
    adjustCommissionDelay = adjustDelay_;
  }

  function setMinimumAmount(uint256 minimumAmount_) external onlyOwner {
    minimumAmount = minimumAmount_;
  }

  //////////////////////////////
  // Public and internal functions
  //////////////////////////////

  function uncomittedStakeOf(address layer2, address account) external view returns (uint256) {
    AutoRefactorCoinageI coinage = _coinages[layer2];

    uint256 prevFactor = coinage.factor();
    uint256 prevTotalSupply = coinage.totalSupply();
    uint256 nextTotalSupply = _tot.balanceOf(layer2);
    uint256 newFactor = _calcNewFactor(prevTotalSupply, nextTotalSupply, prevFactor);

    uint256 uncomittedBalance = rmul(
      rdiv(coinage.balanceOf(account), prevFactor),
      newFactor
    );

    return uncomittedBalance
      .sub(_coinages[layer2].balanceOf(account));
  }

  function stakeOf(address layer2, address account) external view returns (uint256) {
    return _coinages[layer2].balanceOf(account);
  }

  function _calcNewFactor(uint256 source, uint256 target, uint256 oldFactor) internal pure returns (uint256) {
    return rdiv(rmul(target, oldFactor), source);
  }

  // DEV ONLY
  event CommitLog1(uint256 totalStakedAmount, uint256 totalSupplyOfWTON, uint256 prevTotalSupply, uint256 nextTotalSupply);

  function _increaseTot() internal returns (bool) {
    // short circuit if already seigniorage is given.
    if (block.number == _lastSeigBlock) {
      return false;
    }

    if (_tot.totalSupply() == 0) {
      _lastSeigBlock = block.number;
      return false;
    }

    uint256 prevTotalSupply;
    uint256 nextTotalSupply;

    // 1. increase total supply of {tot} by maximum seigniorages * staked rate
    //    staked rate = total staked amount / total supply of (W)TON

    prevTotalSupply = _tot.totalSupply();

    // maximum seigniorages
    uint256 maxSeig = _calcNumSeigBlocks().mul(_seigPerBlock);

    // total supply of (W)TON
    uint256 tos = _ton.totalSupply()
      .sub(_ton.balanceOf(address(_wton)))
      .mul(10 ** 9)                                       // convert TON total supply into ray
      .add(_tot.totalSupply());  // consider additional TOT balance as total supply

    // maximum seigniorages * staked rate
    uint256 stakedSeig = rdiv(
      rmul(
        maxSeig,
        // total staked amount
        _tot.totalSupply()
      ),
      tos
    );

    // pseig
    uint256 totalPseig = rmul(maxSeig.sub(stakedSeig), relativeSeigRate);

    nextTotalSupply = prevTotalSupply.add(stakedSeig).add(totalPseig);
    _lastSeigBlock = block.number;

    _tot.setFactor(_calcNewFactor(prevTotalSupply, nextTotalSupply, _tot.factor()));

    // TODO: reduce computation
    // DEV ONLY
    emit CommitLog1(
      _tot.totalSupply(),
      tos,
      prevTotalSupply,
      nextTotalSupply
    );

    uint256 unstakedSeig = maxSeig.sub(stakedSeig);
    uint256 powertonSeig;
    uint256 daoSeig;
    uint256 relativeSeig;

    if (address(_powerton) != address(0)) {
      powertonSeig = rmul(unstakedSeig, powerTONSeigRate);
      _wton.mint(address(_powerton), powertonSeig);
    }

    if (dao != address(0)) {
      daoSeig = rmul(unstakedSeig, daoSeigRate);
      _wton.mint(address(dao), daoSeig);
    }

    if (relativeSeigRate != 0) {
      relativeSeig = totalPseig;
      accRelativeSeig = accRelativeSeig.add(relativeSeig);
    }

    emit SeigGiven(msg.sender, maxSeig, stakedSeig, unstakedSeig, powertonSeig, relativeSeig);

    return true;
  }

  function _calcNumSeigBlocks() internal view returns (uint256) {
    require(!paused());

    uint256 span = block.number - _lastSeigBlock;
    if (_unpausedBlock < _lastSeigBlock) {
      return span;
    }

    return span - (_unpausedBlock - _pausedBlock);
  }

  function _isOperator(address layer2, address operator) internal view returns (bool) {
    return operator == Layer2I(layer2).operator();
  }

  //////////////////////////////
  // Storage getters
  //////////////////////////////

  // solium-disable
  function registry() external view returns (address) { return address(_registry); }
  function depositManager() external view returns (address) { return address(_depositManager); }
  function ton() external view returns (address) { return address(_ton); }
  function wton() external view returns (address) { return address(_wton); }
  function powerton() external view returns (address) { return address(_powerton); }
  function tot() external view returns (address) { return address(_tot); }
  function coinages(address layer2) external view returns (address) { return address(_coinages[layer2]); }
  function commissionRates(address layer2) external view returns (uint256) { return _commissionRates[layer2]; }
  function isCommissionRateNegative(address layer2) external view returns (bool) { return _isCommissionRateNegative[layer2]; }

  function lastCommitBlock(address layer2) external view returns (uint256) { return _lastCommitBlock[layer2]; }
  function seigPerBlock() external view returns (uint256) { return _seigPerBlock; }
  function lastSeigBlock() external view returns (uint256) { return _lastSeigBlock; }
  function pausedBlock() external view returns (uint256) { return _pausedBlock; }
  function unpausedBlock() external view returns (uint256) { return _unpausedBlock; }

  function DEFAULT_FACTOR() external view returns (uint256) { return _DEFAULT_FACTOR; }
  // solium-enable

}
