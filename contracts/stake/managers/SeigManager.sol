pragma solidity ^0.5.12;

import { Ownable } from "../../../node_modules/openzeppelin-solidity/contracts/ownership/Ownable.sol";
import { Pausable } from "../../../node_modules/openzeppelin-solidity/contracts/lifecycle/Pausable.sol";
import { SafeMath } from "../../../node_modules/openzeppelin-solidity/contracts/math/SafeMath.sol";
import { ERC20Mintable } from "../../../node_modules/openzeppelin-solidity/contracts/token/ERC20/ERC20Mintable.sol";
import { IERC20 } from "../../../node_modules/openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "../../../node_modules/openzeppelin-solidity/contracts/token/ERC20/SafeERC20.sol";

import { DSMath } from "../../../node_modules/coinage-token/contracts/lib/DSMath.sol";
import { CustomIncrementCoinageMock as CustomIncrementCoinage } from "../../../node_modules/coinage-token/flatten.sol";

import { AuthController } from "../tokens/AuthController.sol";

import { RootChainI } from "../../RootChainI.sol";

import { SeigManagerI } from "../interfaces/SeigManagerI.sol";
import { RootChainRegistryI } from "../interfaces/RootChainRegistryI.sol";
import { DepositManagerI } from "../interfaces/DepositManagerI.sol";



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

  //////////////////////////////
  // Token-related
  //////////////////////////////

  // TON token contract
  IERC20 internal _ton;

  // WTON token contract
  ERC20Mintable internal _wton; // TODO: use mintable erc20!

  // track total deposits of each root chain.
  CustomIncrementCoinage internal _tot;

  // coinage token for each root chain.
  mapping (address => CustomIncrementCoinage) internal _coinages;

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

  //////////////////////////////
  // Modifiers
  //////////////////////////////

  modifier onlyRegistry() {
    require(msg.sender == address(_registry));
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

  event CoinageCreated(address rootchain, address coinage);

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

    _tot = new CustomIncrementCoinage(
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
   * @dev deploy coinage token for the root chain.
   */
  function deployCoinage(address rootchain) external onlyRegistry returns (bool) {
    // short circuit if already coinage is deployed
    if (address(_coinages[rootchain]) != address(0)) {
      return false;
    }

    // create new coinage token for the root chain contract
    if (address(_coinages[rootchain]) == address(0)) {
      _coinages[rootchain] = new CustomIncrementCoinage(
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

  event SeigGiven(address rootchain, uint256 totalSeig, uint256 stakedSeig, uint256 unstakedSeig);
  event Comitted(address rootchain);

  // test log...
  event CommitLog1(uint256 totalStakedAmount, uint256 totalSupplyOfWTON, uint256 prevTotalSupply, uint256 nextTotalSupply);

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

    // 2. increase total supply of {coinages[rootchain]}
    CustomIncrementCoinage coinage = _coinages[msg.sender];

    uint256 prevTotalSupply = coinage.totalSupply();
    uint256 nextTotalSupply = _tot.balanceOf(msg.sender);

    coinage.setFactor(_calcNewFactor(prevTotalSupply, nextTotalSupply, coinage.factor()));

    // gives seigniorages to the root chain as coinage

    _lastCommitBlock[msg.sender] = block.number;

    _wton.mint(address(this), nextTotalSupply.sub(prevTotalSupply));

    // emit events
    emit Comitted(msg.sender);

    return true;
  }

  /**
   * @dev Callback for a token transfer
   */
  function onTransfer(address sender, address recipient, uint256 amount) external returns (bool) {
    require(msg.sender == address(_ton) || msg.sender == address(_wton), "SeigManager: only TON or WTON can call onTransfer");

    if (!paused()) {
      _increaseTot();
    }

    return true;
  }

  /**
   * @dev Callback for a new deposit
   */
  function onStake(address rootchain, address account, uint256 amount)
    external
    onlyDepositManager
    checkCoinage(rootchain)
    returns (bool)
  {
    _tot.mint(rootchain, amount);
    _coinages[rootchain].mint(account, amount);
    return true;
  }

  event UnstakeLog(uint coinageBurnAmount, uint totBurnAmount);

  function onUnstake(address rootchain, address account, uint256 amount)
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

    emit UnstakeLog(amount, totAmount);

    return true;
  }

  function additionalTotBurnAmount(address rootchain, address account, uint256 amount) external view returns (uint256 totAmount) { return _additionalTotBurnAmount(rootchain, account, amount); }

  // return ⍺, where ⍺ = (tot.balanceOf(rootchain) - coinages[rootchain].totalSupply()) * (amount / coinages[rootchain].totalSupply())
  function _additionalTotBurnAmount(address rootchain, address account, uint256 amount)
    internal
    view
    returns (uint256 totAmount)
  {
    uint256 coinageTotalSupply = _coinages[rootchain].totalSupply();

    return rdiv(
      rmul(
        _tot.balanceOf(rootchain).sub(coinageTotalSupply),
        amount
      ),
      coinageTotalSupply
    );
  }

  //////////////////////////////
  // Public and internal functions
  //////////////////////////////

  function uncomittedStakeOf(address rootchain, address account) external view returns (uint256) {
    CustomIncrementCoinage coinage = _coinages[rootchain];

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

    // maximum seigniorages * staked rate
    uint256 stakedSeig = rdiv(
      rmul(
        maxSeig,
        // total staked amount
        _tot.totalSupply()
      ),
      // total supply of (W)TON
      _ton.totalSupply()
        .sub(_ton.balanceOf(address(_wton)))
        .mul(10 ** 9)                                     // convert TON total supply into ray
        .add(_wton.totalSupply())                         // add WTON total supply
        .add(_tot.totalSupply()).sub(_wton.totalSupply()) // consider additional TOT balance as total supply
    );

    nextTotalSupply = prevTotalSupply.add(stakedSeig);
    _lastSeigBlock = block.number;

    _tot.setFactor(_calcNewFactor(prevTotalSupply, nextTotalSupply, _tot.factor()));


    emit CommitLog1(
      // total staked amount
      _tot.totalSupply(),

      // total supply of (W)TON
      _ton.totalSupply()
        .sub(_ton.balanceOf(address(_wton)))
        .mul(10 ** 9)                                       // convert TON total supply into ray
        .add(_wton.totalSupply())                           // add WTON total supply
        .add(_tot.totalSupply()).sub(_wton.totalSupply()),  // consider additional TOT balance as total supply

      prevTotalSupply,
      nextTotalSupply
    );


    // TODO: give unstaked amount to jackpot
    uint256 unstakedSeig = maxSeig.sub(stakedSeig);

    emit SeigGiven(msg.sender, maxSeig, stakedSeig, unstakedSeig);

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

  function registry() external view returns (RootChainRegistryI) { return _registry; }
  function depositManager() external view returns (DepositManagerI) { return _depositManager; }
  function ton() external view returns (IERC20) { return _ton; }
  function wton() external view returns (ERC20Mintable) { return _wton; }
  function tot() external view returns (CustomIncrementCoinage) { return _tot; }
  function coinages(address rootchain) external view returns (CustomIncrementCoinage) { return _coinages[rootchain]; }

  function lastCommitBlock(address rootchain) external view returns (uint256) { return _lastCommitBlock[rootchain]; }
  function seigPerBlock() external view returns (uint256) { return _seigPerBlock; }
  function lastSeigBlock() external view returns (uint256) { return _lastSeigBlock; }
  function DEFAULT_FACTOR() external view returns (uint256) { return _DEFAULT_FACTOR; }

}