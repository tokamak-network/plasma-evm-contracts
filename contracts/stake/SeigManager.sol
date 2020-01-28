pragma solidity ^0.5.0;

import { Ownable } from "../../node_modules/openzeppelin-solidity/contracts/ownership/Ownable.sol";
import { SafeMath } from "../../node_modules/openzeppelin-solidity/contracts/math/SafeMath.sol";
import { ERC20Mintable } from "../../node_modules/openzeppelin-solidity/contracts/token/ERC20/ERC20Mintable.sol";
import { SafeERC20 } from "../../node_modules/openzeppelin-solidity/contracts/token/ERC20/SafeERC20.sol";

import { DSMath } from "../../node_modules/coinage-token/contracts/lib/DSMath.sol";
import { FixedIncrementCoinageMock as FixedIncrementCoinage } from "../../node_modules/coinage-token/contracts/mock/FixedIncrementCoinageMock.sol";
import { CustomIncrementCoinageMock as CustomIncrementCoinage } from "../../node_modules/coinage-token/contracts/mock/CustomIncrementCoinageMock.sol";

import { RootChainI } from "../RootChainI.sol";
import { RootChainRegistry } from "./RootChainRegistry.sol";
import { DepositManager } from "./DepositManager.sol";


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
 *  1. mint {v} {coinages[rootchain]} tokens to the depositor
 *  2. mint {v} {tot} tokens to the root chain contract
 *
 * For each unstake or undelegate (or get rewards) with amount of {v} to a RootChain,
 *  1. burn {v} {coinages[rootchain]} tokens from the depositor
 *  2. burn {v + ⍺} {tot} tokens from the root chain contract,
 *   where ⍺ = SEIGS * staked ratio of the root chian * withdrawal ratio of the depositor
 *     - SEIGS                              = tot total supply - tot total supply at last commit from the root chain
 *     - staked ratio of the root chian     = tot balance of the root chain / tot total supply
 *     - withdrawal ratio of the depositor  = amount to withdraw / total supply of coinage
 *
 */
contract SeigManager  is DSMath, Ownable {
  using SafeMath for uint256;
  using SafeERC20 for ERC20Mintable;

  //////////////////////////////
  // Common contracts
  //////////////////////////////

  RootChainRegistry public registry;
  DepositManager public depositManager;

  //////////////////////////////
  // Token-related
  //////////////////////////////

  // WTON token contract
  ERC20Mintable public ton;

  // WTON token contract
  ERC20Mintable public wton; // TODO: use mintable erc20!

  // track total deposits of each root chain.
  CustomIncrementCoinage public tot;

  // coinage token for each root chain.
  mapping (address => CustomIncrementCoinage) public coinages;

  // last commit block number for each root chain.
  mapping (address => uint256) public lastCommitBlock;

  // total seigniorage per block
  uint256 public seigPerBlock;

  // the block number when seigniorages are given
  uint256 public lastSeigBlock;

  // tot total supply at commit from root chain
  mapping (address => uint256) public totTotalSupplyAtCommit;

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

  modifier onlyRootChain(address rootchain) {
    require(registry.rootchains(rootchain));
    _;
  }

  modifier checkCoinage(address rootchain) {
    require(address(coinages[rootchain]) != address(0), "SeigManager: coinage has not been deployed yet");
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
    ERC20Mintable _ton,
    ERC20Mintable _wton,
    RootChainRegistry _registry,
    DepositManager _depositManager,
    uint256 _seigPerBlock
  ) public {
    ton = _ton;
    wton = _wton;
    registry = _registry;
    depositManager = _depositManager;
    seigPerBlock = _seigPerBlock;

    tot = new CustomIncrementCoinage(
      "",
      "",
      DEFAULT_FACTOR,
      false
    );

    lastSeigBlock = block.number;
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
        false
      );
      lastCommitBlock[rootchain] = block.number;
      totTotalSupplyAtCommit[rootchain] = tot.totalSupply();
      emit CoinageCreated(rootchain, address(coinages[rootchain]));
    }

    return true;
  }

  event SeigGiven(address rootchain, uint256 totalSeig, uint256 stakedSeig, uint256 unstakedSeig);
  event Comitted(address rootchain);

  // test log...
  event CommitLog1(uint256 totalStakedAmount, uint256 totalSupplyOfWTON, uint256 prevTotalSupply, uint256 nextTotalSupply);

  /**
   * @dev A proxy function for a new commit
   */
  function onCommit()
    external
    checkCoinage(msg.sender)
    returns (bool)
  {
    _increaseTot();

    // 2. increase total supply of {coinages[rootchain]}
    CustomIncrementCoinage coinage = coinages[msg.sender];

    uint256 prevTotalSupply = coinage.totalSupply();
    uint256 nextTotalSupply = tot.balanceOf(msg.sender);

    coinage.setFactor(_calcNewFactor(prevTotalSupply, nextTotalSupply, coinage.factor()));

    // gives seigniorages to the root chain as coinage

    lastCommitBlock[msg.sender] = block.number;
    totTotalSupplyAtCommit[msg.sender] = tot.totalSupply();

    wton.mint(address(this), nextTotalSupply.sub(prevTotalSupply));

    // emit events
    emit Comitted(msg.sender);

    return true;
  }

  /**
   * @dev A proxy function for a token transfer
   */
  function onTransfer(address sender, address recipient, uint256 amount) external returns (bool) {
    require(msg.sender == address(ton) || msg.sender == address(wton), "SeigManager: only TON or WTON can call onTransfer");
    _increaseTot();
    return true;
  }

  /**
   * @dev A proxy function for a new deposit
   */
  function onStake(address rootchain, address depositor, uint256 amount)
    external
    onlyDepositManager
    checkCoinage(rootchain)
    returns (bool)
  {
    coinages[rootchain].mint(depositor, amount);
    tot.mint(rootchain, amount);
    return true;
  }

  event UnstakeLog(uint coinageBurnAmount, uint totBurnAmount);

  function onUnstake(address rootchain, address depositor, uint256 amount)
    public
    onlyDepositManager
    checkCoinage(rootchain)
    returns (bool)
  {
    require(coinages[rootchain].balanceOf(depositor) >= amount, "SeigManager: insufficiant balance to unstake");

    // burn {v + ⍺} {tot} tokens to the root chain contract,
    uint256 totAmount = additionalTotBurnAmount(rootchain, depositor, amount);
    tot.burnFrom(rootchain, amount.add(totAmount));

    // burn {v} {coinages[rootchain]} tokens to the depositor
    coinages[rootchain].burnFrom(depositor, amount);

    emit UnstakeLog(amount, totAmount);

    return true;
  }

  // TODO: consider ⍺ when root chain did not commit at all.
  // return ⍺, where ⍺ = SEIGS * staked ratio of the root chian * withdrawal ratio of the depositor
  //   - SEIGS                              = tot total supply - tot total supply at last commit from the root chain
  //   - staked ratio of the root chian     = tot balance of the root chain / tot total supply
  //   - withdrawal ratio of the depositor  = amount to withdraw / total supply of coinage
  function additionalTotBurnAmount(address rootchain, address depositor, uint256 amount)
    public
    view
    returns (uint256 totAmount)
  {
    // short circuit if no commit
    if (totTotalSupplyAtCommit[rootchain] == 0) {
      return 0;
    }

    uint256 prevTotTotalSupply = totTotalSupplyAtCommit[rootchain];

    totAmount = rdiv(
      rdiv(
        rmul(
          rmul(
            tot.totalSupply().sub(prevTotTotalSupply),  // `SEIGS`
            amount                                      // times `amount to withdraw`
          ),
          tot.balanceOf(rootchain)                      // times `tot balance of the root chain`
        ),
        coinages[rootchain].totalSupply()               // div `total supply of coinage`
      ),
      tot.totalSupply()                                 // div `tot total supply`
    );
  }

  //////////////////////////////
  // Public and internal functions
  //////////////////////////////

  function uncomittedStakeOf(address rootchain, address depositor) public view returns (uint256) {
    CustomIncrementCoinage coinage = coinages[rootchain];

    uint256 prevFactor = coinage.factor();
    uint256 prevTotalSupply = coinage.totalSupply();
    uint256 nextTotalSupply = tot.balanceOf(rootchain);
    uint256 newFactor = _calcNewFactor(prevTotalSupply, nextTotalSupply, prevFactor);

    uint256 uncomittedBalance = rmul(
      rdiv(coinage.balanceOf(depositor), prevFactor),
      newFactor
    );

    return uncomittedBalance
      .sub(coinages[rootchain].balanceOf(depositor));
  }

  function stakeOf(address rootchain, address depositor) public view returns (uint256) {
    return coinages[rootchain].balanceOf(depositor);
  }

  function _calcNewFactor(uint256 source, uint256 target, uint256 oldFactor) internal pure returns (uint256) {
    return rdiv(rmul(target, oldFactor), source);
  }

  function _increaseTot() internal returns (bool) {
    // short circuit if already seigniorage is given.
    if (block.number == lastSeigBlock) {
      return false;
    }

    if (tot.totalSupply() == 0) {
      lastSeigBlock = block.number;
      return false;
    }

    uint256 prevTotalSupply;
    uint256 nextTotalSupply;

    // 1. increase total supply of {tot} by maximum seigniorages * staked rate
    //    staked rate = total staked amount / total supply of (W)TON

    prevTotalSupply = tot.totalSupply();

    // maximum seigniorages
    uint256 maxSeig = (block.number - lastSeigBlock).mul(seigPerBlock);

    // maximum seigniorages * staked rate
    uint256 stakedSeig = rdiv(
      rmul(
        maxSeig,
        // total staked amount
        tot.totalSupply()
      ),
      // total supply of (W)TON
      ton.totalSupply()
        .sub(ton.balanceOf(address(wton)))
        .mul(10 ** 9)                                   // convert TON total supply into ray
        .add(wton.totalSupply())                        // add WTON total supply
        .add(tot.totalSupply()).sub(wton.totalSupply()) // consider additional TOT balance as total supply
    );

    nextTotalSupply = prevTotalSupply.add(stakedSeig);
    lastSeigBlock = block.number;

    tot.setFactor(_calcNewFactor(prevTotalSupply, nextTotalSupply, tot.factor()));


    emit CommitLog1(
      // total staked amount
      tot.totalSupply(),

      // total supply of (W)TON
      ton.totalSupply()
        .sub(ton.balanceOf(address(wton)))
        .mul(10 ** 9)                                   // convert TON total supply into ray
        .add(wton.totalSupply())                        // add WTON total supply
        .add(tot.totalSupply()).sub(wton.totalSupply()), // consider additional TOT balance as total supply

      prevTotalSupply,
      nextTotalSupply
    );


    // TODO: give unstaked amount to jackpot
    uint256 unstakedSeig = maxSeig.sub(stakedSeig);

    emit SeigGiven(msg.sender, maxSeig, stakedSeig, unstakedSeig);

    return true;
  }
}