pragma solidity ^0.5.12;

import { Ownable } from "../../../node_modules/openzeppelin-solidity/contracts/ownership/Ownable.sol";
import { Pausable } from "../../../node_modules/openzeppelin-solidity/contracts/lifecycle/Pausable.sol";
import { SafeMath } from "../../../node_modules/openzeppelin-solidity/contracts/math/SafeMath.sol";
import { ERC20Mintable } from "../../../node_modules/openzeppelin-solidity/contracts/token/ERC20/ERC20Mintable.sol";
import { IERC20 } from "../../../node_modules/openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "../../../node_modules/openzeppelin-solidity/contracts/token/ERC20/SafeERC20.sol";

import { DSMath } from "../../lib/DSMath.sol";
//import { CustomIncrementCoinageMock } from "../../../node_modules/coinage-token/flatten.sol";
//import { AutoRefactorCoinage } from "../../../node_modules/coinage-token/flatten.sol";
//import { AutoRefactorCoinage } from "../tokens/AutoRefactorCoinage.sol";
import { AutoRefactorCoinageI } from "../interfaces/AutoRefactorCoinageI.sol";
import { CoinageFactoryI } from "../interfaces/CoinageFactoryI.sol";

import { AuthController } from "../tokens/AuthController.sol";
import { ChallengerRole } from "../../roles/ChallengerRole.sol";

import { RootChainI } from "../../RootChainI.sol";

import { SeigManagerI } from "../interfaces/SeigManagerI.sol";
import { RootChainRegistryI } from "../interfaces/RootChainRegistryI.sol";
import { DepositManagerI } from "../interfaces/DepositManagerI.sol";
import { PowerTONI } from "../interfaces/PowerTONI.sol";



/**
 * @dev SeigManager gives seigniorage to operator and WTON holders.
 * For each commit by operator, operator (or user) will get seigniorage
 * in propotion to the staked (or delegated) amount of WTON.
 *
 * [Tokens]
 * - {tot} tracks total staked or delegated WTON of each RootChain contract (and depositor?).
 * - {coinages[rootchain]} tracks staked or delegated WTON of user or operator to a RootChain contract.
 *
 * For each commit by operator,
 *  1. increases all root chains' balance of {tot} by (the staked amount of WTON) /
 *     (total supply of TON and WTON) * (num blocks * seigniorage per block).
 *  2. increases all depositors' blanace of {coinages[rootchain]} in proportion to the staked amount of WTON,
 *     up to the increased amount in step (1).
 *  3. set the root chain's balance of {committed} as the root chain's {tot} balance.
 *
 * For each stake or delegate with amount of {v} to a RootChain,
 *  1. mint {v} {coinages[rootchain]} tokens to the account
 *  2. mint {v} {tot} tokens to the root chain contract
 *
 * For each unstake or undelegate (or get rewards) with amount of {v} to a RootChain,
 *  1. burn {v} {coinages[rootchain]} tokens from the account
 *  2. burn {v + ⍺} {tot} tokens from the root chain contract,
 *   where ⍺ = SEIGS * staked ratio of the root chian * withdrawal ratio of the account
 *     - SEIGS                              = tot total supply - tot total supply at last commit from the root chain
 *     - staked ratio of the root chian     = tot balance of the root chain / tot total supply
 *     - withdrawal ratio of the account  = amount to withdraw / total supply of coinage
 *
 */
contract SeigManager is SeigManagerI, DSMath, Ownable, Pausable, AuthController, ChallengerRole {
  using SafeMath for uint256;
  using SafeERC20 for ERC20Mintable;

  //////////////////////////////
  // Common contracts
  //////////////////////////////

  RootChainRegistryI internal _registry;
  DepositManagerI internal _depositManager;
  PowerTONI internal _powerton;
  address public _dao;

  //////////////////////////////
  // Token-related
  //////////////////////////////

  // TON token contract
  IERC20 internal _ton;

  // WTON token contract
  ERC20Mintable internal _wton; // TODO: use mintable erc20!

  // contract factory
  CoinageFactoryI public factory;

  // track total deposits of each root chain.
  //CustomIncrementCoinageMock internal _tot;
  AutoRefactorCoinageI internal _tot;

  // coinage token for each root chain.
  //mapping (address => CustomIncrementCoinageMock) internal _coinages;
  mapping (address => AutoRefactorCoinageI) internal _coinages;

  // last commit block number for each root chain.
  mapping (address => uint256) internal _lastCommitBlock;

  // total seigniorage per block
  uint256 internal _seigPerBlock;

  // the block number when seigniorages are given
  uint256 internal _lastSeigBlock;

  // block number when paused or unpaused
  uint256 internal _pausedBlock;
  uint256 internal _unpausedBlock;

  // global minimum withdrawal period
  //uint256 public globalMinimumWithdrawalPeriod;

  // minimum withdrawal period
  //mapping (address => uint256) public minimumWithdrawalPeriod;

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

  modifier onlyRegistryOrOperator(address rootchain) {
    require(msg.sender == address(_registry) || msg.sender == RootChainI(rootchain).operator());
    _;
  }

  modifier onlyDepositManager() {
    require(msg.sender == address(_depositManager));
    _;
  }

  modifier onlyRootChain(address rootchain) {
    require(_registry.rootchains(rootchain));
    _;
  }

  modifier checkCoinage(address rootchain) {
    require(address(_coinages[rootchain]) != address(0), "SeigManager: coinage has not been deployed yet");
    _;
  }

  //////////////////////////////
  // Events
  //////////////////////////////

  event CoinageCreated(address indexed rootchain, address coinage);
  event SeigGiven(address indexed rootchain, uint256 totalSeig, uint256 stakedSeig, uint256 unstakedSeig, uint256 powertonSeig);
  event Comitted(address indexed rootchain);
  event CommissionRateSet(address indexed rootchain, uint256 previousRate, uint256 newRate);

  //////////////////////////////
  // Constuctor
  //////////////////////////////

  constructor (
    ERC20Mintable ton,
    ERC20Mintable wton,
    RootChainRegistryI registry,
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
    /*_tot = new CustomIncrementCoinageMock(
      "",
      "",
      _DEFAULT_FACTOR,
      false
    );*/
    /*_tot = new AutoRefactorCoinage(
      "",
      "",
      _DEFAULT_FACTOR
    );*/
    address c = factory.deploy();
    _tot = AutoRefactorCoinageI(c);
    //_tot = CustomIncrementCoinageMock(factory.deploy());

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
    _dao = daoAddress;
  }

  /**
   * @dev deploy coinage token for the root chain.
   */
  function deployCoinage(address rootchain) external onlyRegistry returns (bool) {
    // create new coinage token for the root chain contract
    if (address(_coinages[rootchain]) == address(0)) {
      /*_coinages[rootchain] = new CustomIncrementCoinageMock(
        "",
        "",
        _DEFAULT_FACTOR,
        false
      );*/
      address c = factory.deploy();
      _lastCommitBlock[rootchain] = block.number;
      addChallenger(c);
      _coinages[rootchain] = AutoRefactorCoinageI(c);
      emit CoinageCreated(rootchain, c);
    }

    return true;
  }

  function setCommissionRate(
    address rootchain,
    uint256 commissionRate,
    bool isCommissionRateNegative
  )
    external
    onlyRegistryOrOperator(rootchain)
    returns (bool)
  {
    // check commission range
    require(
      (commissionRate == 0) ||
      (MIN_VALID_COMMISSION <= commissionRate && commissionRate <= MAX_VALID_COMMISSION),
      "SeigManager: commission rate must be 0 or between 1 RAY and 0.01 RAY"
    );

    uint256 previous = _commissionRates[rootchain];
    if (adjustCommissionDelay == 0) {
      _commissionRates[rootchain] = commissionRate;
      _isCommissionRateNegative[rootchain] = isCommissionRateNegative;
    } else {
      delayedCommissionBlock[rootchain] = block.number + adjustCommissionDelay;
      delayedCommissionRate[rootchain] = commissionRate;
      delayedCommissionRateNegative[rootchain] = isCommissionRateNegative;
    }

    emit CommissionRateSet(rootchain, previous, commissionRate);

    return true;
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

    _increaseTot();

    _lastCommitBlock[msg.sender] = block.number;

    // 2. increase total supply of {coinages[rootchain]}
    AutoRefactorCoinageI coinage = _coinages[msg.sender];

    uint256 prevTotalSupply = coinage.totalSupply();
    uint256 nextTotalSupply = _tot.balanceOf(msg.sender);

    // short circuit if there is no seigs for the root chain
    if (prevTotalSupply >= nextTotalSupply) {
      emit Comitted(msg.sender);
      return true;
    }

    uint256 seigs = nextTotalSupply - prevTotalSupply;
    address operator = RootChainI(msg.sender).operator();
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

    // gives seigniorages to the root chain as coinage
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
    address rootchain,
    AutoRefactorCoinageI coinage,
    uint256 prevTotalSupply,
    uint256 seigs,
    bool isCommissionRateNegative,
    address operator
  ) internal returns (
    uint256 nextTotalSupply,
    uint256 operatorSeigs
  ) {
    if (block.number >= delayedCommissionBlock[rootchain] && delayedCommissionBlock[rootchain] != 0) {
      _commissionRates[rootchain] = delayedCommissionRate[rootchain];
      _isCommissionRateNegative[rootchain] = delayedCommissionRateNegative[rootchain];
      delayedCommissionBlock[rootchain] = 0;
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

  function _calcSlashFactor(
    AutoRefactorCoinageI coinage,
    uint256 slashAmount
  ) internal returns (uint256) {
    uint256 prevTotalSupply = coinage.totalSupply();
    uint256 newFactor = rdiv(prevTotalSupply.sub(slashAmount), prevTotalSupply.div(coinage.factor()));
    return newFactor;
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
  function onDeposit(address rootchain, address account, uint256 amount)
    external
    onlyDepositManager
    checkCoinage(rootchain)
    returns (bool)
  {
    if (_isOperator(rootchain, account)) {
      uint256 newAmount = _coinages[rootchain].balanceOf(account).add(amount);
      require(newAmount >= minimumAmount, "minimum amount is required");
    }
    _tot.mint(rootchain, amount);
    _coinages[rootchain].mint(account, amount);
    if (address(_powerton) != address(0)) {
      _powerton.onDeposit(rootchain, account, amount);
    }
    return true;
  }

  // DEV ONLY
  event UnstakeLog(uint coinageBurnAmount, uint totBurnAmount);

  function onWithdraw(address rootchain, address account, uint256 amount)
    external
    onlyDepositManager
    checkCoinage(rootchain)
    returns (bool)
  {
    require(_coinages[rootchain].balanceOf(account) >= amount, "SeigManager: insufficiant balance to unstake");

    if (_isOperator(rootchain, account)) {
      require(_coinages[rootchain].balanceOf(account) >= amount, "test 1234");
      uint256 newAmount = _coinages[rootchain].balanceOf(account).sub(amount);
      require(newAmount >= minimumAmount, "minimum amount is required");
    }

    // burn {v + ⍺} {tot} tokens to the root chain contract,
    uint256 totAmount = _additionalTotBurnAmount(rootchain, account, amount);
    require(_tot.balanceOf(rootchain) >= amount.add(totAmount), "test 111");
    _tot.burnFrom(rootchain, amount.add(totAmount));

    // burn {v} {coinages[rootchain]} tokens to the account
    require(_coinages[rootchain].balanceOf(account) >= amount, "test 222");
    _coinages[rootchain].burnFrom(account, amount);

    if (address(_powerton) != address(0)) {
      _powerton.onWithdraw(rootchain, account, amount);
    }

    emit UnstakeLog(amount, totAmount);

    return true;
  }

  /*function setGlobalMinimumWithdrawalPeriod(uint256 minimumWithdrawalPeriod) external onlyOwner {
    globalMinimumWithdrawalPeriod = minimumWithdrawalPeriod;
  }*/

  /*function setMinimumWithdrawalPeriod(uint256 minimumWithdrawalPeriod_) external onlyOwner {
    minimumWithdrawalPeriod = minimumWithdrawalPeriod_;
  }*/

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

  function slash(address rootchain, address challenger) external onlyChallenger returns (bool) {
    // TODO: check
    RootChainI(rootchain).changeOperator(challenger);

    return true;
  }

  function additionalTotBurnAmount(address rootchain, address account, uint256 amount)
    external
    view
    returns (uint256 totAmount)
  {
    return _additionalTotBurnAmount(rootchain, account, amount);
  }

  // return ⍺, where ⍺ = (tot.balanceOf(rootchain) - coinages[rootchain].totalSupply()) * (amount / coinages[rootchain].totalSupply())
  function _additionalTotBurnAmount(address rootchain, address account, uint256 amount)
    internal
    view
    returns (uint256 totAmount)
  {
    uint256 coinageTotalSupply = _coinages[rootchain].totalSupply();
    uint256 totBalalnce = _tot.balanceOf(rootchain);

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

  function uncomittedStakeOf(address rootchain, address account) external view returns (uint256) {
    AutoRefactorCoinageI coinage = _coinages[rootchain];

    uint256 prevFactor = coinage.factor();
    uint256 prevTotalSupply = coinage.totalSupply();
    uint256 nextTotalSupply = _tot.balanceOf(rootchain);
    uint256 newFactor = _calcNewFactor(prevTotalSupply, nextTotalSupply, prevFactor);

    uint256 uncomittedBalance = rmul(
      rdiv(coinage.balanceOf(account), prevFactor),
      newFactor
    );

    return uncomittedBalance
      .sub(_coinages[rootchain].balanceOf(account));
  }

  function stakeOf(address rootchain, address account) external view returns (uint256) {
    return _coinages[rootchain].balanceOf(account);
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
    //uint256 stakedSeig = rmul(maxSeig, RAY.sub(powerTONSeigRate).sub(daoSeigRate));

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
      powertonSeig = unstakedSeig.mul(powerTONSeigRate).div(RAY);

      _wton.mint(address(_powerton), powertonSeig);
    }

    if (_dao != address(0)) {
      //daoSeig = unstakedSeig.mul(_factorDao).div(_DEFAULT_FACTOR);
      daoSeig = unstakedSeig.mul(daoSeigRate).div(RAY);
      _wton.mint(address(_dao), daoSeig);
    }

    if (relativeSeigRate != 0) {
      relativeSeig = unstakedSeig.mul(relativeSeigRate).div(RAY);
      accRelativeSeig = accRelativeSeig.add(relativeSeig);
    }

    require(powertonSeig.add(daoSeig).add(relativeSeig) <= unstakedSeig, "powerton seig + dao seig exceeded unstaked amount");

    emit SeigGiven(msg.sender, maxSeig, stakedSeig, unstakedSeig, powertonSeig);

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

  function _isOperator(address rootchain, address operator) internal view returns (bool) {
    return operator == RootChainI(rootchain).operator();
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
  function coinages(address rootchain) external view returns (address) { return address(_coinages[rootchain]); }
  function commissionRates(address rootchain) external view returns (uint256) { return _commissionRates[rootchain]; }
  function isCommissionRateNegative(address rootchain) external view returns (bool) { return _isCommissionRateNegative[rootchain]; }

  function lastCommitBlock(address rootchain) external view returns (uint256) { return _lastCommitBlock[rootchain]; }
  function seigPerBlock() external view returns (uint256) { return _seigPerBlock; }
  function lastSeigBlock() external view returns (uint256) { return _lastSeigBlock; }
  function pausedBlock() external view returns (uint256) { return _pausedBlock; }
  function unpausedBlock() external view returns (uint256) { return _unpausedBlock; }

  function DEFAULT_FACTOR() external view returns (uint256) { return _DEFAULT_FACTOR; }
  // solium-enable

}
