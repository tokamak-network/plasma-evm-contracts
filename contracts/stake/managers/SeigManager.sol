pragma solidity ^0.5.12;

import { Ownable } from "../../../node_modules/openzeppelin-solidity/contracts/ownership/Ownable.sol";
import { Pausable } from "../../../node_modules/openzeppelin-solidity/contracts/lifecycle/Pausable.sol";
import { SafeMath } from "../../../node_modules/openzeppelin-solidity/contracts/math/SafeMath.sol";
import { ERC20Mintable } from "../../../node_modules/openzeppelin-solidity/contracts/token/ERC20/ERC20Mintable.sol";
import { IERC20 } from "../../../node_modules/openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "../../../node_modules/openzeppelin-solidity/contracts/token/ERC20/SafeERC20.sol";

import { DSMath } from "../../../node_modules/coinage-token/contracts/lib/DSMath.sol";
import { CustomIncrementCoinageMock } from "../../../node_modules/coinage-token/flatten.sol";

import { AuthController } from "../tokens/AuthController.sol";

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
contract SeigManager is SeigManagerI, DSMath, Ownable, Pausable, AuthController {
  using SafeMath for uint256;
  using SafeERC20 for ERC20Mintable;

  //////////////////////////////
  // Common contracts
  //////////////////////////////

  RootChainRegistryI internal _registry;
  DepositManagerI internal _depositManager;
  PowerTONI internal _powerton;

  //////////////////////////////
  // Token-related
  //////////////////////////////

  // TON token contract
  IERC20 internal _ton;

  // WTON token contract
  ERC20Mintable internal _wton; // TODO: use mintable erc20!

  // track total deposits of each root chain.
  CustomIncrementCoinageMock internal _tot;

  // coinage token for each root chain.
  mapping (address => CustomIncrementCoinageMock) internal _coinages;

  // commission rates in RAY
  mapping (address => uint256) internal _commissionRates;

  // whether commission is negative or not (default=possitive)
  mapping (address => bool) internal _isCommissionRateNegative;

  // last commit block number for each root chain.
  mapping (address => uint256) internal _lastCommitBlock;

  // total seigniorage per block
  uint256 internal _seigPerBlock;

  // the block number when seigniorages are given
  uint256 internal _lastSeigBlock;

  // block number when paused or unpaused
  uint256 internal _pausedBlock;
  uint256 internal _unpausedBlock;

  //////////////////////////////
  // Constants
  //////////////////////////////

  uint256 constant internal _DEFAULT_FACTOR = 10 ** 27;
  uint256 constant public POWER_TON_NUMERATOR = 5;
  uint256 constant public POWER_TON_DENOMINATOR = 10;

  uint256 constant public MAX_VALID_COMMISSION = 10 ** 27; // 1 RAY
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
    uint256 seigPerBlock
  ) public {
    _ton = ton;
    _wton = wton;
    _registry = registry;
    _depositManager = depositManager;
    _seigPerBlock = seigPerBlock;

    _tot = new CustomIncrementCoinageMock(
      "",
      "",
      _DEFAULT_FACTOR,
      false
    );

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


  /**
   * @dev deploy coinage token for the root chain.
   */
  function deployCoinage(address rootchain) external onlyRegistry returns (bool) {
    // short circuit if already coinage is deployed
    if (address(_coinages[rootchain]) != address(0)) {
      return false;
    }

    // create new coinage token for the root chain contract
    if (address(_coinages[rootchain]) == address(0)) {
      _coinages[rootchain] = new CustomIncrementCoinageMock(
        "",
        "",
        _DEFAULT_FACTOR,
        false
      );
      _lastCommitBlock[rootchain] = block.number;
      emit CoinageCreated(rootchain, address(_coinages[rootchain]));
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
    _commissionRates[rootchain] = commissionRate;
    _isCommissionRateNegative[rootchain] = isCommissionRateNegative;

    emit CommissionRateSet(rootchain, previous, commissionRate);

    return true;
  }

  /**
   * @dev Callback for a new commit
   */
  function onCommit()
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
    CustomIncrementCoinageMock coinage = _coinages[msg.sender];

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
    CustomIncrementCoinageMock coinage,
    uint256 prevTotalSupply,
    uint256 seigs,
    bool isCommissionRateNegative,
    address operator
  ) internal returns (
    uint256 nextTotalSupply,
    uint256 operatorSeigs
  ) {
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

    // See negative commission distribution formular here: TBD
    require(prevTotalSupply > 0, "SeigManager: negative commission rate requires deposits");

    uint256 operatorRate = rdiv(coinage.balanceOf(operator), prevTotalSupply);

    require(operatorRate > 0, "SeigManager: negative commission rate requires operator's stake");

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
  function onDeposit(address rootchain, address account, uint256 amount)
    external
    onlyDepositManager
    checkCoinage(rootchain)
    returns (bool)
  {
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

    // burn {v + ⍺} {tot} tokens to the root chain contract,
    uint256 totAmount = _additionalTotBurnAmount(rootchain, account, amount);
    _tot.burnFrom(rootchain, amount.add(totAmount));

    // burn {v} {coinages[rootchain]} tokens to the account
    _coinages[rootchain].burnFrom(account, amount);

    if (address(_powerton) != address(0)) {
      _powerton.onWithdraw(rootchain, account, amount);
    }

    emit UnstakeLog(amount, totAmount);

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

  //////////////////////////////
  // Public and internal functions
  //////////////////////////////

  function uncomittedStakeOf(address rootchain, address account) external view returns (uint256) {
    CustomIncrementCoinageMock coinage = _coinages[rootchain];

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
      .add(_wton.totalSupply())                           // add WTON total supply
      .add(_tot.totalSupply()).sub(_wton.totalSupply());  // consider additional TOT balance as total supply

    // maximum seigniorages * staked rate
    uint256 stakedSeig = rdiv(
      rmul(
        maxSeig,
        // total staked amount
        _tot.totalSupply()
      ),
      tos
    );

    nextTotalSupply = prevTotalSupply.add(stakedSeig);
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

    if (address(_powerton) != address(0)) {
      // out of gas..?
      // powertonSeig = unstakedSeig.mul(POWER_TON_NUMERATOR).div(POWER_TON_DENOMINATOR);
      powertonSeig = unstakedSeig * POWER_TON_NUMERATOR / POWER_TON_DENOMINATOR;

      _wton.mint(address(_powerton), powertonSeig);
    }

    emit SeigGiven(msg.sender, maxSeig, stakedSeig, unstakedSeig, powertonSeig);

    return true;
  }

  function _calcNumSeigBlocks() internal returns (uint256) {
    require(!paused());

    uint256 span = block.number - _lastSeigBlock;
    if (_unpausedBlock < _lastSeigBlock) {
      return span;
    }

    return span - (_unpausedBlock - _pausedBlock);
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

  function lastCommitBlock(address rootchain) external view returns (uint256) { return _lastCommitBlock[rootchain]; }
  function seigPerBlock() external view returns (uint256) { return _seigPerBlock; }
  function lastSeigBlock() external view returns (uint256) { return _lastSeigBlock; }
  function pausedBlock() external view returns (uint256) { return _pausedBlock; }
  function unpausedBlock() external view returns (uint256) { return _unpausedBlock; }

  function DEFAULT_FACTOR() external view returns (uint256) { return _DEFAULT_FACTOR; }
  // solium-enable
}
