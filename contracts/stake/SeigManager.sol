pragma solidity ^0.5.0;

import { Ownable } from "openzeppelin-solidity/contracts/ownership/Ownable.sol";
import { SafeMath } from "openzeppelin-solidity/contracts/math/SafeMath.sol";
import { IERC20 } from "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "openzeppelin-solidity/contracts/token/ERC20/SafeERC20.sol";

import { DSMath } from "coinage-token/contracts/lib/DSMath.sol";
import { FixedIncrementCoinageMock as FixedIncrementCoinage } from "coinage-token/contracts/mock/FixedIncrementCoinageMock.sol";
import { CustomIncrementCoinageMock as CustomIncrementCoinage } from "coinage-token/contracts/mock/CustomIncrementCoinageMock.sol";

import { RootChainI } from "../RootChainI.sol";
import { RootChainRegistry } from "./RootChainRegistry.sol";
import { DepositManager } from "./DepositManager.sol";


/**
 * @dev SeigManager gives seigniorage to operator and TON holders.
 * For each commit by operator, operator (or user) will get seigniorage
 * in propotion to the staked (or delegated) amount of TON.
 *
 * {tot} tracks total staked or delegated TON of each RootChain contract.
 * {coinages[rootchain]} tracks staked or delegated TON of user or operator to a RootChain contract.
 *
 * For each commit by operator, {tot} increases the balance of root chain. And SeigManager
 *  1. increases all depositors' blanace of {coinage[rootchain]} by change the factor.
 *
 * For each stake or delegate with amount of {v} to a RootChain,
 *  1. mint {v} {coinages[rootchain]} tokens to the depositor
 *  2. mint {v} {tot} tokens to the root chain contract
 *
 * For each unstake or undelegate (or get rewards) with amount of {v} to a RootChain,
 *  1. burn {v} {coinages[rootchain]} tokens to the depositor
 *  2. burn {v + ⍺} {tot} tokens to the root chain contract,
 *   where ⍺ = tot.seigPerBlock() * num blocks * v / tot.balanceOf(rootchain)
 *
 */
contract SeigManager  is DSMath, Ownable {
  using SafeMath for uint256;
  using SafeERC20 for IERC20;

  //////////////////////////////
  // Common contracts
  //////////////////////////////

  RootChainRegistry public registry;
  DepositManager public depositManager;

  //////////////////////////////
  // Token-related
  //////////////////////////////

  // TON token contract
  IERC20 public ton; // TODO: use mintable erc20!

  // track total deposits of each root chain.
  FixedIncrementCoinage public tot;

  // coinage token for each root chain.
  mapping (address => CustomIncrementCoinage) public coinages;

  // last commit block number for each root chain.
  mapping (address => uint256) public lastCommitBlock;

  //////////////////////////////
  // Constants
  //////////////////////////////

  uint256 constant public DEFAULT_FACTOR = 10 ** 27;

  //////////////////////////////
  // Modifiers
  //////////////////////////////

  modifier onlyRegistry() {
    require(msg.sender == address(registry));
    _;
  }

  modifier onlyDepositManager() {
    require(msg.sender == address(depositManager));
    _;
  }


  modifier onlyRootChain(address _rootchain) {
    require(registry.rootchains(_rootchain));
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
    IERC20 _ton,
    RootChainRegistry _registry,
    DepositManager _depositManager
  ) public {
    ton = _ton;
    registry = _registry;
    depositManager = _depositManager;
  }

  //////////////////////////////
  // External functions
  //////////////////////////////

  /**
   * @dev deploy coinage token for the root chain.
   */
  function deployCoinage(address rootchain) external onlyRegistry returns (bool) {
    // short circuit if already coinage is deployed
    if (address(coinages[rootchain]) != address(0)) {
      return false;
    }

    // create new coinage token for the root chain contract
    if (address(coinages[rootchain]) == address(0)) {
      coinages[rootchain] = new CustomIncrementCoinage(
        "",
        "",
        DEFAULT_FACTOR,
        true
      );
      lastCommitBlock[rootchain] = block.number;
      emit CoinageCreated(rootchain, address(coinages[rootchain]));
    }

    return true;
  }

  /**
   * @dev A proxy function for a new commit
   */
  function onCommit(address rootchain)
    external
    onlyDepositManager
    returns (bool)
  {
    lastCommitBlock[rootchain] = block.number;

    CustomIncrementCoinage coinage = coinages[rootchain];

    uint256 prevTotalSupply = coinage.totalSupply();
    uint256 nextTotalSupply = tot.balanceOf(rootchain);

    coinage.setFactor(rdiv(nextTotalSupply, prevTotalSupply));
  }

  /**
   * @dev A proxy function for a new deposit
   */
  function onStake(address rootchain, address depositor, uint256 amount)
    external
    onlyDepositManager
    returns (bool)
  {
    coinages[rootchain].mint(depositor, amount);
    tot.mint(rootchain, amount);
  }

  /**
   * @dev A proxy function for a new withdrawal
   */
  function onUnstake(address rootchain, address depositor, uint256 amount)
    external
    onlyDepositManager
    returns (bool)
  {
    require(lastCommitBlock[rootchain] > 0, "SeigManager: cannot unstake tokens for uncommitted root chian");

    uint256 totAmount = tot.seigPerBlock()
      .mul(block.number - lastCommitBlock[rootchain])
      .mul(rdiv(amount, tot.balanceOf(rootchain)));
    totAmount = totAmount.add(amount);

    coinages[rootchain].burnFrom(depositor, amount);
    tot.burnFrom(rootchain, totAmount);
  }

  //////////////////////////////
  // Public and internal fuhnctions
  //////////////////////////////

  function uncomittedRewardOf(address rootchain, address depositor) public view returns (uint256) {
    // uint256 totAmount = tot.seigPerBlock()
    //   .mul(block.number - lastCommitBlock[rootchain])
    //   .mul(rdiv(amount, tot.balanceOf(rootchain)));
    // totAmount = totAmount.add(amount);

  }

  function rewardOf(address rootchain, address depositor) public view returns (uint256) {
    return coinages[rootchain].balanceOf(depositor).sub(depositManager.deposits(rootchain, depositor));
  }

  function _onstake() internal returns (bool) {

  }

  function _getStakeStats() internal returns (uint256 stakedAmount, uint256 unstakedAmount) {
    stakedAmount = ton.balanceOf(address(depositManager));
    unstakedAmount = ton.totalSupply().sub(stakedAmount);
  }
}