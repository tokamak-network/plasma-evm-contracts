const range = require('lodash/range');
const first = require('lodash/first');
const last = require('lodash/last');

const { createCurrency, createCurrencyRatio } = require('@makerdao/currency');
const {
  defaultSender, accounts, contract, web3,
} = require('@openzeppelin/test-environment');
const {
  BN, constants, expectEvent, expectRevert, time, ether,
} = require('@openzeppelin/test-helpers');

const { padLeft, toBN } = require('web3-utils');
const { marshalString, unmarshalString } = require('../helpers/marshal');

const WTON = contract.fromArtifact('WTON');
const TON = contract.fromArtifact('TON');

const EpochHandler = contract.fromArtifact('EpochHandler');
const SubmitHandler = contract.fromArtifact('SubmitHandler');
const Layer2 = contract.fromArtifact('Layer2');
const EtherToken = contract.fromArtifact('EtherToken');

const CoinageFactory = contract.fromArtifact('CoinageFactory');

const DepositManager = contract.fromArtifact('DepositManager');
const SeigManager = contract.fromArtifact('SeigManager');
const Layer2Registry = contract.fromArtifact('Layer2Registry');
//const CustomIncrementCoinage = contract.fromArtifact('CustomIncrementCoinage');
const AutoRefactorCoinage = contract.fromArtifact('AutoRefactorCoinage');
const PowerTON = contract.fromArtifact('PowerTON');
const DAOVault = contract.fromArtifact('DAOVault');

const chai = require('chai');
const { expect } = chai;
chai.use(require('chai-bn')(BN))
  .should();

const LOGTX = process.env.LOGTX || false;
const VERBOSE = process.env.VERBOSE || false;

const log = (...args) => LOGTX && console.log(...args);

let o;
process.on('exit', function () {
  console.log(o);
});
const development = true;

const _TON = createCurrency('TON');
const _WTON = createCurrency('WTON');
const _WTON_TON = createCurrencyRatio(_WTON, _TON);

//const e = web3.utils.toBN('1000000000'); // 1e9
const e = web3.utils.toBN('1000000000000000000'); // 1e18

const TON_UNIT = 'wei';
const WTON_UNIT = 'ray';
const WTON_TON_RATIO = _WTON_TON('1');

const [tokenOwner1, tokenOwner2] = accounts;
const operator = defaultSender;

const dummyStatesRoot = '0xdb431b544b2f5468e3f771d7843d9c5df3b4edcf8bc1c599f18f0b4ea8709bc3';
const dummyTransactionsRoot = '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421';
const dummyReceiptsRoot = '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421';

const TON_INITIAL_SUPPLY = _TON('50000000');
//const SEIG_PER_BLOCK = TON_INITIAL_SUPPLY.times(WTON_TON_RATIO).div(1000); // 100 (W)TON / block
const SEIG_PER_BLOCK = _WTON('3.91615931'); // 100 (W)TON / block
const WITHDRAWAL_DELAY = 10;
const NUM_ROOTCHAINS = 4;
const POWERTON_SEIG_RATE = _WTON('0.1');
const DAO_SEIG_RATE = _WTON('0.5');
const PSEIG_RATE = _WTON('0.4');

const tokenAmount = TON_INITIAL_SUPPLY.div(10000); // 1000 TON
const tokenOwnerInitialBalance = tokenAmount.times(NUM_ROOTCHAINS); // 200000 TON

const totalStakedAmount = tokenOwnerInitialBalance; // 200000 TON
const totalUnstakedAmount = TON_INITIAL_SUPPLY.minus(tokenOwnerInitialBalance); // 49800000 TON

const NRE_LENGTH = 2;

const ROUND_DURATION = time.duration.minutes(1);

const MAX_COMMISSION_RATE = _WTON('1.0');

class Layer2State {
  constructor (NRE_LENGTH) {
    this.currentFork = 0;
    this.lastEpoch = 0;
    this.lastBlock = 0;
    this.NRE_LENGTH = Number(NRE_LENGTH);
  }
}

function toWTONString (bn, d = 10) {
  let isNeg = false;
  if (bn.isNeg()) {
    bn = bn.neg();
    isNeg = true;
  }

  const negSign = isNeg ? '-' : '';

  return negSign + _WTON(toBN(bn), WTON_UNIT).toString(d);
}

/**
 *
 * @param {Contract} seigManager
 * @param {String} layer2Addr
 * @param {String} userAddr
 * @returns {Object.operatorSeigs}
 * @returns {Object.userSeigs}
 */
async function expectedSeigs (seigManager, layer2Addr, userAddr) {
  // contracts
  const layer2 = await Layer2.at(layer2Addr);
  const ton = await TON.at(await seigManager.ton());
  const wton = await TON.at(await seigManager.wton());
  const tot = await AutoRefactorCoinage.at(await seigManager.tot());
  const coinageAddr = await seigManager.coinages(layer2Addr);
  const coinage = await AutoRefactorCoinage.at(coinageAddr);

  // storages
  const operator = await layer2.operator();
  const seigPerBlock = _WTON(await seigManager.seigPerBlock(), WTON_UNIT);
  const prevTotTotalSupply = _WTON(await tot.totalSupply(), WTON_UNIT);
  const prevTotBalance = _WTON(await tot.balanceOf(layer2Addr), WTON_UNIT);
  const prevCoinageTotalSupply = _WTON(await coinage.totalSupply(), WTON_UNIT);
  const prevCoinageOperatorBalance = _WTON(await coinage.balanceOf(operator), WTON_UNIT);
  const prevCoinageUsersBalance = prevCoinageTotalSupply.minus(prevCoinageOperatorBalance);
  const prevCoinageUserBalance = _WTON(await coinage.balanceOf(userAddr), WTON_UNIT);
  const commissioniRate = _WTON(await seigManager.commissionRates(layer2Addr), WTON_UNIT);
  const isCommissionRateNegative = await seigManager.isCommissionRateNegative(layer2Addr);

  // helpers
  async function calcNumSeigBlocks () {
    if (await seigManager.paused()) return 0;

    const blockNumber = await web3.eth.getBlockNumber();
    const lastSeigBlock = Number(await seigManager.lastSeigBlock());
    const unpausedBlock = Number(await seigManager.unpausedBlock());
    const pausedBlock = Number(await seigManager.pausedBlock());

    const span = blockNumber - lastSeigBlock + 1; // + 1 for new block

    if (unpausedBlock < lastSeigBlock) {
      return span;
    }

    return span - (unpausedBlock - pausedBlock);
  }

  async function increaseTot () {
    const maxSeig = seigPerBlock.times(await calcNumSeigBlocks());
    const tos = _WTON(await ton.totalSupply(), TON_UNIT)
      .plus(_WTON(await tot.totalSupply(), WTON_UNIT))
      .minus(_WTON(await ton.balanceOf(wton.address), TON_UNIT));

    const stakedSeigs = maxSeig.times(prevTotTotalSupply).div(tos);
    //const stakedSeigs = maxSeig.times(_WTON('1').sub(POWERTON_SEIG_RATE).sub(DAO_SEIG_RATE));
    const pseigs = maxSeig.minus(stakedSeigs).times(PSEIG_RATE)
    return {stakedSeigs, pseigs};
  }

  const {stakedSeigs, pseigs} = await increaseTot();
  const layer2Seigs = stakedSeigs.plus(pseigs).times(prevTotBalance).div(prevTotTotalSupply);

  const operatorSeigs = layer2Seigs.times(prevCoinageOperatorBalance).div(prevCoinageTotalSupply);
  const usersSeigs = layer2Seigs.times(prevCoinageUsersBalance).div(prevCoinageTotalSupply);

  function _calcSeigsDistribution () {
    let operatorSeigsWithCommissionRate = operatorSeigs;
    let usersSeigsWithCommissionRate = usersSeigs;

    if (commissioniRate.toFixed(WTON_UNIT) === '0') {
      return {
        operatorSeigsWithCommissionRate,
        usersSeigsWithCommissionRate,
      };
    }

    if (!isCommissionRateNegative) {
      const commissionFromUsers = usersSeigs.times(commissioniRate);

      operatorSeigsWithCommissionRate = operatorSeigsWithCommissionRate.plus(commissionFromUsers);
      usersSeigsWithCommissionRate = usersSeigsWithCommissionRate.minus(commissionFromUsers);
      return {
        operatorSeigsWithCommissionRate,
        usersSeigsWithCommissionRate,
      };
    }

    if (prevCoinageTotalSupply.toFixed(WTON_UNIT) === '0' ||
      prevCoinageOperatorBalance.toFixed(WTON_UNIT) === '0') {
      return {
        operatorSeigsWithCommissionRate,
        usersSeigsWithCommissionRate,
      };
    }

    const commissionFromOperator = operatorSeigs.times(commissioniRate);

    operatorSeigsWithCommissionRate = operatorSeigsWithCommissionRate.minus(commissionFromOperator);
    usersSeigsWithCommissionRate = usersSeigsWithCommissionRate.plus(commissionFromOperator);

    return {
      operatorSeigsWithCommissionRate,
      usersSeigsWithCommissionRate,
    };
  }

  const {
    operatorSeigsWithCommissionRate,
    usersSeigsWithCommissionRate,
  } = _calcSeigsDistribution();

  const userSeigsWithCommissionRate = usersSeigsWithCommissionRate.times(prevCoinageUserBalance).div(prevCoinageUsersBalance);

  return {
    operatorSeigs: operatorSeigsWithCommissionRate,
    userSeigs: userSeigsWithCommissionRate,
    layer2Seigs: layer2Seigs,
    usersSeigs: usersSeigs,
  };
}

describe('stake/SeigManager', function () {
  function makePos (v1, v2) { return toBN(v1).shln(128).add(toBN(v2)); }

  async function checkBalanceProm (balanceProm, expected, unit) {
    return checkBalance(await balanceProm, expected, unit);
  }

  function checkBalance (balanceBN, expected, unit) {
    const v = balanceBN.sub(toBN(expected.toFixed(unit))).abs();
    // if (v.cmp(e) > 0) {
    //   console.error(`
    //     actual   : ${balanceBN.toString().padStart(40)}
    //     expected : ${expected.toFixed(unit).padStart(40)}
    //     diff     : ${v.toString().padStart(40)}
    //     e        : ${e.toString().padStart(40)}

    //   `);
    // }
    v.should.be.bignumber.lte(e);
  }

  /**
   *
   * @param {*} layer2
   * @param {Layer2State} layer2State
   */
  async function submitDummyNRE (layer2, layer2State) {
    const pos1 = makePos(layer2State.currentFork, layer2State.lastEpoch + 1);
    const pos2 = makePos(layer2State.lastBlock + 1, layer2State.lastBlock + layer2State.NRE_LENGTH);

    layer2State.lastEpoch += 2; // skip ORE
    layer2State.lastBlock += layer2State.NRE_LENGTH;

    const COST_NRB = await layer2.COST_NRB();

    return layer2.submitNRE(
      pos1,
      pos2,
      dummyStatesRoot,
      dummyTransactionsRoot,
      dummyReceiptsRoot,
      { value: COST_NRB },
    );
  }

  async function submitDummyNREs (layer2, layer2State, n) {
    for (const _ of range(n)) {
      await time.increase(time.duration.seconds(1));
      await submitDummyNRE(layer2, layer2State);
    }
  }

  async function advanceBlocks(count) {
    for (const _ of range(count)) {
      await time.advanceBlock();
    }
  }

  // deploy contract and instances
  beforeEach(async function () {
    this.ton = await TON.new();
    this.wton = await WTON.new(this.ton.address);

    this.etherToken = await EtherToken.new(true, this.ton.address, true);

    const epochHandler = await EpochHandler.new();
    const submitHandler = await SubmitHandler.new(epochHandler.address);

    this.layer2s = await Promise.all(range(NUM_ROOTCHAINS).map(_ => Layer2.new(
      epochHandler.address,
      submitHandler.address,
      this.etherToken.address,
      development,
      NRE_LENGTH,
      dummyStatesRoot,
      dummyTransactionsRoot,
      dummyReceiptsRoot,
    )));

    // layer2 state in local
    this.layer2State = {};
    for (const layer2 of this.layer2s) {
      this.layer2State[layer2.address] = new Layer2State(NRE_LENGTH);
    }

    this.registry = await Layer2Registry.new();

    this.depositManager = await DepositManager.new(
      this.wton.address,
      this.registry.address,
      WITHDRAWAL_DELAY,
    );

    this.factory = await CoinageFactory.new();
    this.daoVault = await DAOVault.new(this.ton.address, 0);

    this.seigManager = await SeigManager.new(
      this.ton.address,
      this.wton.address,
      this.registry.address,
      this.depositManager.address,
      SEIG_PER_BLOCK.toFixed(WTON_UNIT),
      this.factory.address
    );

    this.factory.setSeigManager(this.seigManager.address);

    this.powerton = await PowerTON.new(
      this.seigManager.address,
      this.wton.address,
      ROUND_DURATION,
    );

    await this.powerton.init();

    await this.seigManager.setPowerTON(this.powerton.address);
    await this.powerton.start();
    await this.seigManager.setDao(this.daoVault.address);

    // add minter roles
    await this.wton.addMinter(this.seigManager.address);
    await this.ton.addMinter(this.wton.address);

    // set seig manager to contracts
    await Promise.all([
      this.depositManager,
      this.wton,
    ].map(contract => contract.setSeigManager(this.seigManager.address)));
    await Promise.all(this.layer2s.map(layer2 => layer2.setSeigManager(this.seigManager.address)));

    // register layer2 and deploy coinage
    await Promise.all(this.layer2s.map(layer2 => this.registry.registerAndDeployCoinage(layer2.address, this.seigManager.address)));

    // mint TON to accounts
    await this.ton.mint(operator, TON_INITIAL_SUPPLY.toFixed(TON_UNIT));
    await this.ton.approve(this.wton.address, TON_INITIAL_SUPPLY.toFixed(TON_UNIT));

    // load tot token and coinage tokens
    this.tot = await AutoRefactorCoinage.at(await this.seigManager.tot());
    const coinageAddrs = await Promise.all(
      this.layer2s.map(layer2 => this.seigManager.coinages(layer2.address)),
    );

    this.coinages = [];
    this.coinagesByLayer2 = {};
    for (const addr of coinageAddrs) {
      const i = coinageAddrs.findIndex(a => a === addr);
      this.coinages[i] = await AutoRefactorCoinage.at(addr);
      this.coinagesByLayer2[this.layer2s[i].address] = this.coinages[i];
    }

    // contract-call wrapper functions
    this._deposit = (from, to, amount) => this.depositManager.deposit(to, amount, { from });
    this._commit = (layer2) => submitDummyNRE(layer2, this.layer2State[layer2.address]);
    this._multiCommit = (layer2, n) => submitDummyNREs(layer2, this.layer2State[layer2.address], n);

    this.seigManager.setPowerTONSeigRate(POWERTON_SEIG_RATE.toFixed(WTON_UNIT));
    this.seigManager.setDaoSeigRate(DAO_SEIG_RATE.toFixed(WTON_UNIT));
    this.seigManager.setPseigRate(PSEIG_RATE.toFixed(WTON_UNIT));

    /*console.log(`
    tokenOwner1 balance : ${await this.ton.balanceOf(tokenOwner1)}
    operator balance : ${await this.ton.balanceOf(operator)}
    `);*/
  });

  it('minimum deposit amount', async function () {
    const minimumAmount = TON_INITIAL_SUPPLY;
    await this.seigManager.setMinimumAmount(minimumAmount.toFixed(WTON_UNIT));
    await this.wton.swapFromTONAndTransfer(operator, tokenAmount.toFixed(TON_UNIT));

    await this.wton.approve(this.depositManager.address, tokenAmount.toFixed(WTON_UNIT), { from: operator });
    await expectRevert(
      this._deposit(operator, this.layer2s[0].address, tokenAmount.toFixed(WTON_UNIT))
      , "minimum amount is required"
    );
  });

  describe('when the token owner are the only depositor of each layer2', function () {
    beforeEach(async function () {
      await this.wton.swapFromTONAndTransfer(tokenOwner1, tokenOwnerInitialBalance.toFixed(TON_UNIT));

      await this.wton.approve(this.depositManager.address, tokenOwnerInitialBalance.toFixed(WTON_UNIT), { from: tokenOwner1 });
    });

    describe('when the token owner equally deposit WTON to all layer2s', function () {
      beforeEach(async function () {
        // deposit from the token owner
        this.receipts = await Promise.all(this.layer2s.map(
          layer2 => this._deposit(tokenOwner1, layer2.address, tokenAmount.toFixed(WTON_UNIT)),
        ));
      });

      afterEach(function () {
        delete this.receipts;
      });

      it('should emit Deposited event', function () {
        this.receipts.forEach(({ logs }, i) => {
          const layer2 = this.layer2s[i];
          expectEvent.inLogs(logs, 'Deposited', {
            layer2: layer2.address,
            depositor: tokenOwner1,
            amount: tokenAmount.toFixed(WTON_UNIT),
          });
        });
      });

      it('WTON balance of the token owner must be zero', async function () {
        expect(await this.wton.balanceOf(tokenOwner1)).to.be.bignumber.equal('0');
      });

      it('deposit manager should have deposited WTON tokens', async function () {
        expect(await this.wton.balanceOf(this.depositManager.address))
          .to.be.bignumber.equal(
            tokenAmount.times(NUM_ROOTCHAINS).toFixed(WTON_UNIT),
          );
      });

      it('coinage balance of the token owner must be increased by deposited WTON amount', async function () {
        await Promise.all(this.coinages.map(
          async (coinage) => {
            expect(await coinage.balanceOf(tokenOwner1))
              .to.be.bignumber.equal(tokenAmount.toFixed(WTON_UNIT));
          },
        ));
      });

      it('tot balance of layer2 must be increased by deposited WTON amount', async function () {
        await Promise.all(this.layer2s.map(
          async (layer2) => {
            expect(await this.tot.balanceOf(layer2.address))
              .to.be.bignumber.equal(tokenAmount.toFixed(WTON_UNIT));
          },
        ));
      });

      // multiple layer2 test
      for (const _i in range(NUM_ROOTCHAINS)) {
        const i = Number(_i);
        const indices = range(0, i + 1);
        const c = indices.map(i => `${i}-th`).join(', ');

        describe(`when ${c} layer2 commits first ORE each`, function () {
          beforeEach(async function () {
            this.previousSeigBlock = await this.seigManager.lastSeigBlock();

            this.totBalancesAtCommit = {}; // track tot balance when layer2 is comitted
            this.accSeig = _WTON('0');
            this.seigs = [];

            o = '';

            for (const i of indices) {
              const layer2 = this.layer2s[i];

              const sb0 = await this.seigManager.lastSeigBlock();
              const prevTotTotalSupply = await this.tot.totalSupply();

              const prevBalance = await this.tot.balanceOf(layer2.address);

              await time.advanceBlock();
              await time.advanceBlock();
              await time.advanceBlock();
              const { tx } = await this._commit(layer2);

              const sb1 = await this.seigManager.lastSeigBlock();
              const curTotTotalSupply = await this.tot.totalSupply();

              const curBalance = await this.tot.balanceOf(layer2.address);

              this.totBalancesAtCommit[layer2.address] = curBalance;

              const {
                args: {
                  totalStakedAmount: _totalStakedAmount,
                  totalSupplyOfWTON,
                  prevTotalSupply,
                  nextTotalSupply,
                },
              } = await expectEvent.inTransaction(tx, this.seigManager, 'CommitLog1');

              const { args: { totalSeig, stakedSeig, unstakedSeig, powertonSeig, pseig } } = await expectEvent.inTransaction(tx, this.seigManager, 'SeigGiven');

              const { args: { previous, current } } = await expectEvent.inTransaction(tx, this.tot, 'FactorSet');

              const seig = _WTON(stakedSeig, WTON_UNIT).plus(_WTON(pseig, WTON_UNIT));

              checkBalance(curTotTotalSupply.sub(prevTotTotalSupply), seig, WTON_UNIT);

              this.seigs.push(seig);
              this.accSeig = this.accSeig.plus(seig);

              // test log....s
              const accSeigAtCommit = this.seigs.slice(0, i + 1).reduce((a, b) => a.plus(b));
              const accSeig = this.accSeig;

              o += `\n\n\n
    ${'-'.repeat(40)}
    ${i}-th layer2 first commit
    ${'-'.repeat(40)}

    totalStakedAmount     : ${_WTON(_totalStakedAmount, 'ray').toString().padStart(15)}
    totalSupplyOfWTON     : ${_WTON(totalSupplyOfWTON, 'ray').toString().padStart(15)}
    prevTotalSupply       : ${_WTON(prevTotalSupply, 'ray').toString().padStart(15)}
    nextTotalSupply       : ${_WTON(nextTotalSupply, 'ray').toString().padStart(15)}

    tot.totalSupply       : ${_WTON(await this.tot.totalSupply(), 'ray').toString().padStart(15)}

    ${'-'.repeat(40)}

    previous factor       : ${_WTON(previous, 'ray').toString().padStart(15)}
    current factor        : ${_WTON(current, 'ray').toString().padStart(15)}

    ${'-'.repeat(40)}

    prevBalance           : ${_WTON(prevBalance, 'ray').toString().padStart(15)}
    curBalance            : ${_WTON(curBalance, 'ray').toString().padStart(15)}

    ${'-'.repeat(40)}

    previous seig block : ${sb0}
    current seig block  : ${sb1}
    numBlocks           : ${sb1.sub(sb0)}

    seigPerBlock        : ${_WTON(await this.seigManager.seigPerBlock(), 'ray').toString().padStart(15)}
    totalSeig           : ${_WTON(totalSeig, 'ray').toString().padStart(15)}
    stakedSeig          : ${_WTON(stakedSeig, 'ray').toString().padStart(15)}
    unstakedSeig        : ${_WTON(unstakedSeig, 'ray').toString().padStart(15)}
    powertonSeig        : ${_WTON(powertonSeig || 0, 'ray').toString().padStart(15)}

    ${'-'.repeat(40)}

    this.seigs          : ${this.seigs.toString().padStart(15)}
    this.accSeig        : ${this.accSeig.toString().padStart(15)}
    accSeigAtCommit     : ${accSeigAtCommit.toString().padStart(15)}
    accSeig             : ${accSeig.toString().padStart(15)}

    ${'='.repeat(40)}
    `;
            }

            this.currentSeigBlock = await this.seigManager.lastSeigBlock();
          });

          for (const _i in indices) {
            const i = Number(_i);
            it(`${i}-th layer2: check amount of total supply, balance, staked amount, uncomitted amount`, async function () {
              const layer2 = this.layer2s[i];

              const accSeigAtCommit = this.seigs.slice(0, i + 1).reduce((a, b) => a.plus(b));
              const balnceAtCommit = tokenAmount.times(WTON_TON_RATIO)
                .plus(accSeigAtCommit.div(NUM_ROOTCHAINS));

              const accSeig = this.accSeig;
              const balanceAtCurrent = tokenAmount.times(WTON_TON_RATIO)
                .plus(accSeig.div(NUM_ROOTCHAINS));

              // tot balance of a layer2
              checkBalance(
                this.totBalancesAtCommit[layer2.address],
                balnceAtCommit,
                WTON_UNIT,
              );

              // coinage total supply
              checkBalance(
                await this.coinagesByLayer2[layer2.address].totalSupply(),
                balnceAtCommit,
                WTON_UNIT,
              );

              // coinage balance of the tokwn owner
              checkBalance(
                await this.coinagesByLayer2[layer2.address].balanceOf(tokenOwner1),
                balnceAtCommit,
                WTON_UNIT,
              );

              // staked amount of the token owner
              checkBalance(
                await this.seigManager.stakeOf(layer2.address, tokenOwner1),
                balnceAtCommit,
                WTON_UNIT,
              );

              // uncomitted amount of the tokwn owner
              checkBalance(
                await this.seigManager.uncomittedStakeOf(layer2.address, tokenOwner1),
                balanceAtCurrent.minus(balnceAtCommit),
                WTON_UNIT,
              );
            });

            it(`${i}-th layer2: the tokwn owner should claim staked amount`, async function () {
              const layer2 = this.layer2s[i];
              const coinage = this.coinagesByLayer2[layer2.address];

              const precomitted = toBN(
                (
                  this.seigs.slice(i + 1).length > 0
                    ? this.seigs.slice(i + 1).reduce((a, b) => a.plus(b)).div(NUM_ROOTCHAINS)
                    : _WTON('0')
                ).toFixed(WTON_UNIT),
              );
              const amount = await this.seigManager.stakeOf(layer2.address, tokenOwner1);
              const additionalTotBurnAmount = await this.seigManager.additionalTotBurnAmount(layer2.address, tokenOwner1, amount);

              // console.log(`
              // amount                     ${amount.toString(10).padStart(30)}
              // precomitted                ${precomitted.toString(10).padStart(30)}
              // additionalTotBurnAmount    ${additionalTotBurnAmount.toString(10).padStart(30)}
              // `);

              const prevWTONBalance = await this.wton.balanceOf(tokenOwner1);
              const prevCoinageTotalSupply = await coinage.totalSupply();
              const prevCoinageBalance = await coinage.balanceOf(tokenOwner1);
              const prevTotTotalSupply = await this.tot.totalSupply();
              const prevTotBalance = await this.tot.balanceOf(layer2.address);

              // 1. make a withdrawal request
              expect(await this.depositManager.pendingUnstaked(layer2.address, tokenOwner1)).to.be.bignumber.equal('0');
              expect(await this.depositManager.accUnstaked(layer2.address, tokenOwner1)).to.be.bignumber.equal('0');

              const tx = await this.depositManager.requestWithdrawal(layer2.address, amount, { from: tokenOwner1 });

              expectEvent.inLogs(
                tx.logs,
                'WithdrawalRequested',
                {
                  layer2: layer2.address,
                  depositor: tokenOwner1,
                  amount: amount,
                },
              );

              const { args: { coinageBurnAmount, totBurnAmount } } = await expectEvent.inTransaction(tx.tx, this.seigManager, 'UnstakeLog');

              // console.log('coinageBurnAmount  ', coinageBurnAmount.toString(10).padStart(35));
              // console.log('totBurnAmount      ', totBurnAmount.toString(10).padStart(35));
              // console.log('diff               ', toBN(totBurnAmount).sub(toBN(coinageBurnAmount)).toString(10).padStart(35));

              expect(await this.depositManager.pendingUnstaked(layer2.address, tokenOwner1)).to.be.bignumber.equal(amount);
              expect(await this.depositManager.accUnstaked(layer2.address, tokenOwner1)).to.be.bignumber.equal('0');

              // 2. process the request
              await expectRevert(this.depositManager.processRequest(layer2.address, false, { from: tokenOwner1 }), 'DepositManager: wait for withdrawal delay');

              await Promise.all(range(WITHDRAWAL_DELAY + 1).map(_ => time.advanceBlock()));

              expectEvent(
                await this.depositManager.processRequest(layer2.address, false, { from: tokenOwner1 }),
                'WithdrawalProcessed',
                {
                  layer2: layer2.address,
                  depositor: tokenOwner1,
                  amount: amount,
                },
              );

              expect(await this.depositManager.pendingUnstaked(layer2.address, tokenOwner1)).to.be.bignumber.equal('0');
              expect(await this.depositManager.accUnstaked(layer2.address, tokenOwner1)).to.be.bignumber.equal(amount);

              const curWTONBalance = await this.wton.balanceOf(tokenOwner1);
              const curCoinageTotalSupply = await coinage.totalSupply();
              const curCoinageBalance = await coinage.balanceOf(tokenOwner1);
              const curTotTotalSupply = await this.tot.totalSupply();
              const curTotBalance = await this.tot.balanceOf(layer2.address);

              // 3. check tokens status
              expect(curWTONBalance.sub(prevWTONBalance))
                .to.be.bignumber.equal(amount);

              expect(curCoinageTotalSupply.sub(prevCoinageTotalSupply))
                .to.be.bignumber.equal(amount.neg());

              expect(curCoinageBalance.sub(prevCoinageBalance))
                .to.be.bignumber.equal(amount.neg());

              checkBalance(
                prevTotTotalSupply.sub(curTotTotalSupply),
                _WTON(amount.add(precomitted), WTON_UNIT),
                WTON_UNIT,
              );

              checkBalance(
                prevTotBalance.sub(curTotBalance),
                _WTON(amount.add(precomitted), WTON_UNIT),
                WTON_UNIT,
              );
            });
          }
        });
      }

      describe('when 0-th layer2 commits 10 times', function () {
        const i = 0;
        const n = 10;

        beforeEach(async function () {
          this.accSeig = _WTON('0');

          this.seigBlocks = [];
          this.totTotalSupplies = [];

          for (const _ of range(n)) {
            this.seigBlocks.push(await this.seigManager.lastSeigBlock());
            this.totTotalSupplies.push(await this.tot.totalSupply());
            await this._commit(this.layer2s[i]);
          }
          this.seigBlocks.push(await this.seigManager.lastSeigBlock());
          this.totTotalSupplies.push(await this.tot.totalSupply());

          this.seigs = [];
          this.accSeigs = [];

          for (let i = 1; i < this.seigBlocks.length; i++) {
            const seig = _WTON(this.totTotalSupplies[i].sub(this.totTotalSupplies[i - 1]), WTON_UNIT);

            this.seigs.push(seig);
            this.accSeig = this.accSeig.plus(seig);
            this.accSeigs.push(this.accSeig);
          }
        });

        /*function behaveWithSeigRate (powertonRate, daoRate, pseigRate) {
          describe('', function () {
          });
        }

        const powertonRates = [
          _WTON('0'),
          _WTON('0.1'),
          _WTON('0.3'),
        ];

        const daoRates = [
          _WTON('0'),
          _WTON('0.3'),
          _WTON('0.5'),
        ];

        const pseigRates = [
          _WTON('0'),
          _WTON('0.3'),
          _WTON('0.1'),
        ];

        for (const j = 0; j < powertonRates.length; j++) {
          (powertonRates[j], daoRates[j], pseigRates[j])
        }*/

        it('should mint correct seigniorages for each commit', async function () {
          for (const j of range(this.seigBlocks.length - 1)) { // for j-th commit
            const currentBlock = await web3.eth.getBlockNumber();
            const nBlocks = this.seigBlocks[j + 1].sub(this.seigBlocks[j]);
            const accSeigBeforeCommit = this.accSeigs[j].minus(this.seigs[j]);

            const totalStaked = tokenAmount.times(WTON_TON_RATIO)
              .times(NUM_ROOTCHAINS)
              .plus(accSeigBeforeCommit);
            const totTotalSupplyBeforeCommit = TON_INITIAL_SUPPLY.times(WTON_TON_RATIO)
              .plus(accSeigBeforeCommit);

            const maxSeig = SEIG_PER_BLOCK.times(nBlocks);
            const stakedSeig = maxSeig
              .times(totalStaked)
              .div(totTotalSupplyBeforeCommit);
            const pseig = maxSeig.minus(stakedSeig).times(PSEIG_RATE);
            const expectedSeig = stakedSeig.plus(pseig);
              //.times(nBlocks);

            checkBalance(
              toBN(this.seigs[j].toFixed(WTON_UNIT)),
              _WTON(expectedSeig.toFixed(WTON_UNIT), WTON_UNIT),
              WTON_UNIT,
            );
          }
        });

        it(`${i}-th layer2: check amount of total supply, balance, staked amount`, async function () {
          const layer2 = this.layer2s[i];

          const expected = tokenAmount.times(WTON_TON_RATIO).plus(this.accSeig.div(4)); // actually not .div(4)...

          // tot total supply is checked in previous test.

          // coinage total supply
          checkBalance(
            await this.coinagesByLayer2[layer2.address].totalSupply(),
            expected,
            WTON_UNIT,
          );

          // coinage balance of the tokwn owner
          checkBalance(
            await this.coinagesByLayer2[layer2.address].balanceOf(tokenOwner1),
            expected,
            WTON_UNIT,
          );

          // staked amount of the token owner
          checkBalance(
            await this.seigManager.stakeOf(layer2.address, tokenOwner1),
            expected,
            WTON_UNIT,
          );
        });

        describe('when the token holder tries to withdraw all stakes', function () {
          let wtonAmount;

          beforeEach(async function () {
            wtonAmount = await this.seigManager.stakeOf(this.layer2s[i].address, tokenOwner1);
          });

          it('should withdraw', async function () {
            const factor0 = await this.coinages[0].factor();
            const tokenOwnerWtonBalance0 = await this.wton.balanceOf(tokenOwner1);
            const depositManagerWtonBalance0 = await this.wton.balanceOf(this.depositManager.address);
            const deposit0 = await this.coinages[0].balanceOf(tokenOwner1);

            await this.depositManager.requestWithdrawal(this.layer2s[i].address, wtonAmount, { from: tokenOwner1 });

            await Promise.all(range(WITHDRAWAL_DELAY + 1).map(_ => time.advanceBlock()));

            await this.depositManager.processRequest(this.layer2s[i].address, false, { from: tokenOwner1 });

            const factor1 = await this.coinages[0].factor();
            const tokenOwnerWtonBalance1 = await this.wton.balanceOf(tokenOwner1);
            const depositManagerWtonBalance1 = await this.wton.balanceOf(this.depositManager.address);
            const deposit1 = await this.coinages[0].balanceOf(tokenOwner1);

            console.log(`
            ###########################################################
            tokenOwnerWtonBalance0 : ${tokenOwnerWtonBalance0}
            tokenOwnerWtonBalance1 : ${tokenOwnerWtonBalance1}
            depositManagerWtonBalance0 : ${depositManagerWtonBalance0}
            depositManagerWtonBalance1 : ${depositManagerWtonBalance1}
            factor0 : ${factor0}
            factor1 : ${factor1}
            ###########################################################
            `);


            let test11 = toBN('100000000000000000000');
            await this.wton.swapFromTONAndTransfer(tokenOwner2, test11);
            await this.wton.approve(this.depositManager.address, test11, { from: tokenOwner2 });
            await this._deposit(tokenOwner2, this.layer2s[0].address, test11);

            //await this.wton.swapFromTONAndTransfer(tokenOwner1, toBN('100'));
            await this.wton.approve(this.depositManager.address, test11, { from: tokenOwner1 });
            await this._deposit(tokenOwner1, this.layer2s[0].address, test11);

            const factor2 = await this.coinages[0].factor();
            const tokenOwnerWtonBalance2 = await this.wton.balanceOf(tokenOwner1);
            const depositManagerWtonBalance2 = await this.wton.balanceOf(this.depositManager.address);
            const deposit2 = await this.coinages[0].balanceOf(tokenOwner1);
            const deposit3 = await this.coinages[0].balanceOf(tokenOwner2);
            const coinageTotalSupply0 = await this.coinages[0].totalSupply();

            console.log(`
            ###########################################################
            tokenOwnerWtonBalance2 : ${tokenOwnerWtonBalance2}
            depositManagerWtonBalance2 : ${depositManagerWtonBalance2}
            factor2 : ${factor2}

            deposit0 : ${deposit0}
            deposit1 : ${deposit1}
            deposit2 : ${deposit2}
            deposit3 : ${deposit3}
            coinageTotalSupply0 : ${coinageTotalSupply0}
            ###########################################################
            `);

            expect(depositManagerWtonBalance1.sub(depositManagerWtonBalance0).neg()).to.be.bignumber.equal(wtonAmount);
            expect(tokenOwnerWtonBalance1.sub(tokenOwnerWtonBalance0)).to.be.bignumber.equal(wtonAmount);
          });

          it('should re-deposit', async function () {
            const tokenOwnerWtonBalance0 = await this.wton.balanceOf(tokenOwner1);
            const depositManagerWtonBalance0 = await this.wton.balanceOf(this.depositManager.address);

            await this.depositManager.requestWithdrawal(this.layer2s[i].address, wtonAmount, { from: tokenOwner1 });

            await Promise.all(range(WITHDRAWAL_DELAY + 1).map(_ => time.advanceBlock()));

            await this.depositManager.redeposit(this.layer2s[i].address, { from: tokenOwner1 });

            const tokenOwnerWtonBalance1 = await this.wton.balanceOf(tokenOwner1);
            const depositManagerWtonBalance1 = await this.wton.balanceOf(this.depositManager.address);

            expect(depositManagerWtonBalance1).to.be.bignumber.equal(depositManagerWtonBalance0);
            expect(tokenOwnerWtonBalance1).to.be.bignumber.equal(tokenOwnerWtonBalance0);
          });

          describe('after the token holder withdraw all stakes in TON', function () {
            let tonAmount;

            beforeEach(async function () {
              await this.depositManager.requestWithdrawal(this.layer2s[i].address, wtonAmount, { from: tokenOwner1 });

              await Promise.all(range(WITHDRAWAL_DELAY + 1).map(_ => time.advanceBlock()));

              const tonBalance0 = await this.ton.balanceOf(tokenOwner1);
              await this.depositManager.processRequest(this.layer2s[i].address, true, { from: tokenOwner1 });
              const tonBalance1 = await this.ton.balanceOf(tokenOwner1);

              tonAmount = tonBalance1.sub(tonBalance0);
            });

            it('the layer2 can commit next epochs', async function () {
              await this._multiCommit(this.layer2s[i], 10);
            });

            it('the token holder can deposit again', async function () {
              const data = marshalString(
                [this.depositManager.address, this.layer2s[i].address]
                  .map(unmarshalString)
                  .map(str => padLeft(str, 64))
                  .join(''),
              );

              await this.ton.approveAndCall(
                this.wton.address,
                tonAmount,
                data,
                { from: tokenOwner1 },
              );
            });

            describe('after the layer2 commits 10 epochs', function () {
              beforeEach(async function () {
                await this._multiCommit(this.layer2s[i], 10);
              });

              it('the token holder can deposit again', async function () {
                const data = marshalString(
                  [this.depositManager.address, this.layer2s[i].address]
                    .map(unmarshalString)
                    .map(str => padLeft(str, 64))
                    .join(''),
                );

                await this.ton.approveAndCall(
                  this.wton.address,
                  tonAmount,
                  data,
                  { from: tokenOwner1 },
                );
              });
            });
          });

          describe('when the token holder make withdrawal request', async function () {
            beforeEach(async function () {
              await this.depositManager.requestWithdrawal(this.layer2s[i].address, wtonAmount, { from: tokenOwner1 });
            });

            it('the token owner can re-deposit', async function () {
              const tx = await this.depositManager.redeposit(this.layer2s[i].address, { from: tokenOwner1 });

              expectEvent.inLogs(tx.logs, 'Deposited', {
                layer2: this.layer2s[i].address,
                depositor: tokenOwner1,
                amount: wtonAmount,
              });
            });

            describe('after the token holder withdraw all stakes in WTON', function () {
              beforeEach(async function () {
                await Promise.all(range(WITHDRAWAL_DELAY + 1).map(_ => time.advanceBlock()));

                await this.depositManager.processRequest(this.layer2s[i].address, false, { from: tokenOwner1 });
              });

              it('the layer2 can commit next epochs', async function () {
                await Promise.all(range(10).map(_ => this._commit(this.layer2s[i])));
              });

              it('the token holder can deposit again', async function () {
                await this.wton.approve(this.depositManager.address, wtonAmount, { from: tokenOwner1 });
                await this._deposit(tokenOwner1, this.layer2s[i].address, wtonAmount);
              });

              describe('after the layer2 commits 10 epochs', function () {
                beforeEach(async function () {
                  await Promise.all(range(10).map(_ => this._commit(this.layer2s[i])));
                });

                it('the token holder can deposit again', async function () {
                  await this.wton.approve(this.depositManager.address, wtonAmount, { from: tokenOwner1 });
                  await this._deposit(tokenOwner1, this.layer2s[i].address, wtonAmount);
                });
              });
            });
          });
        });

        describe('when the token holder tries to withdraw 10% of staked WTON 10 times', function () {
          const n = 10;
          const nBN = toBN(n);
          let amount;

          beforeEach(async function () {
            amount = (await this.seigManager.stakeOf(this.layer2s[i].address, tokenOwner1)).div(nBN);
          });

          it('should withdraw', async function () {
            const tokenOwnerWtonBalance0 = await this.wton.balanceOf(tokenOwner1);
            const depositManagerWtonBalance0 = await this.wton.balanceOf(this.depositManager.address);

            await Promise.all(range(n).map(_ => this.depositManager.requestWithdrawal(this.layer2s[i].address, amount, { from: tokenOwner1 })));

            await Promise.all(range(WITHDRAWAL_DELAY + 1).map(_ => time.advanceBlock()));

            await Promise.all(range(n).map(_ => this.depositManager.processRequest(this.layer2s[i].address, false, { from: tokenOwner1 })));

            const tokenOwnerWtonBalance1 = await this.wton.balanceOf(tokenOwner1);
            const depositManagerWtonBalance1 = await this.wton.balanceOf(this.depositManager.address);

            expect(depositManagerWtonBalance1.sub(depositManagerWtonBalance0).neg()).to.be.bignumber.equal(amount.mul(nBN));
            expect(tokenOwnerWtonBalance1.sub(tokenOwnerWtonBalance0)).to.be.bignumber.equal(amount.mul(nBN));
          });

          it('should re-deposit', async function () {
            const tokenOwnerWtonBalance0 = await this.wton.balanceOf(tokenOwner1);
            const depositManagerWtonBalance0 = await this.wton.balanceOf(this.depositManager.address);

            await Promise.all(range(n).map(_ => this.depositManager.requestWithdrawal(this.layer2s[i].address, amount, { from: tokenOwner1 })));

            await Promise.all(range(WITHDRAWAL_DELAY + 1).map(_ => time.advanceBlock()));

            await Promise.all(range(n).map(_ => this.depositManager.redeposit(this.layer2s[i].address, { from: tokenOwner1 })));

            const tokenOwnerWtonBalance1 = await this.wton.balanceOf(tokenOwner1);
            const depositManagerWtonBalance1 = await this.wton.balanceOf(this.depositManager.address);

            expect(depositManagerWtonBalance1).to.be.bignumber.equal(depositManagerWtonBalance0);
            expect(tokenOwnerWtonBalance1).to.be.bignumber.equal(tokenOwnerWtonBalance0);
          });
        });

        function behaveWhenPausedOrNot () {
          it('commit should not be reverted', async function () {
            await this._commit(this.layer2s[i]);
          });

          it('deposit should not be reverted', async function () {
            const from = tokenOwner1;
            const balance = (await this.wton.balanceOf(from)).div(toBN(NUM_ROOTCHAINS));
            await Promise.all(this.layer2s.map(
              (layer2) =>
                this._deposit(from, layer2.address, balance),
            ));
          });

          it('withdrawal should not be reverted', async function () {
            await Promise.all(
              this.layer2s.map(async (layer2) => {
                const staked = await this.seigManager.stakeOf(layer2.address, tokenOwner1);
                if (staked.cmp(toBN('0')) > 0) {
                  return this.depositManager.requestWithdrawal(layer2.address, staked, { from: tokenOwner1 });
                }
              }),
            );

            await Promise.all(range(WITHDRAWAL_DELAY + 1).map(_ => time.advanceBlock()));

            await Promise.all(
              this.layer2s.map(async (layer2) => {
                const numPendingRequests = await this.depositManager.numPendingRequests(layer2.address, tokenOwner1);

                if (numPendingRequests.cmp(toBN('0')) > 0) {
                  await this.depositManager.processRequests(layer2.address, numPendingRequests, false, { from: tokenOwner1 });
                }

                const staked = await this.seigManager.stakeOf(layer2.address, tokenOwner1);
                expect(staked).to.be.bignumber.equal('0');
              }),
            );
          });
        }

        describe('after seig manager is paused', function () {
          const NUM_WITHDRAWN_ROOTCHAINS = Math.floor(NUM_ROOTCHAINS / 2);

          async function makeWithdrawalRequest (n) {
            await Promise.all(
              this.layer2s.slice(0, n).map(async (layer2) => {
                const staked = await this.seigManager.stakeOf(layer2.address, tokenOwner1);
                const amount = staked.div(toBN(2));
                if (amount.cmp(toBN('0')) > 0) {
                  return this.depositManager.requestWithdrawal(layer2.address, amount, { from: tokenOwner1 });
                }
              }),
            );
          }

          beforeEach(async function () {
            await makeWithdrawalRequest.call(this, NUM_WITHDRAWN_ROOTCHAINS);
            await this.seigManager.pause();
          });

          it('seigniorage must not be given', async function () {
            const totTotalSupply1 = await this.tot.totalSupply();
            await this._commit(this.layer2s[i]);
            const totTotalSupply2 = await this.tot.totalSupply();

            expect(totTotalSupply2).to.be.bignumber.equal(totTotalSupply1);
          });

          behaveWhenPausedOrNot();

          describe('after seig manager is unpaused', function () {
            beforeEach(async function () {
              await makeWithdrawalRequest.call(this, NUM_WITHDRAWN_ROOTCHAINS);
              await this.seigManager.unpause();
            });

            // TODO: check seig amount
            it('seigniorage must be given', async function () {
              const totTotalSupply1 = await this.tot.totalSupply();
              await this._commit(this.layer2s[i]);
              const totTotalSupply2 = await this.tot.totalSupply();

              expect(totTotalSupply2).to.be.bignumber.gt(totTotalSupply1);
            });
          });
        });
      });

      describe('when 0-th layer2 changes commission rate with operator deposit', function () {
        const i = 0;
        const n = 1;

        function behaveWithCommissionRate (operatorRate, commissionRate, isCommissionRateNegative) {
          const operatorRateNr = operatorRate.toNumber();
          const commissionPercent = commissionRate.toNumber() * 100;
          const commissionRateSignStr = isCommissionRateNegative ? 'negative' : 'positive';

          describe(`when the operator deposits ${operatorRateNr} times as much as the token owner did`, function () {
            let depositBlock = 0;
            let operatorAmount = 0;
            beforeEach(async function () {
              if (operatorRateNr === 0) return;

              operatorAmount = tokenAmount.times(operatorRateNr);

              console.log(`
              tokenOwner1 balance : ${await this.ton.balanceOf(tokenOwner1)}
              operator balance : ${await this.ton.balanceOf(operator)}
              operatorAmount : ${operatorAmount}

              operatorRate : ${operatorRate}
              commissionRate : ${commissionRate}
              isCommissionRateNegative : ${isCommissionRateNegative}
              `);

              await this.wton.swapFromTONAndTransfer(operator, operatorAmount.times(NUM_ROOTCHAINS).toFixed(TON_UNIT));
              await this.wton.approve(this.depositManager.address, operatorAmount.times(NUM_ROOTCHAINS).toFixed(WTON_UNIT), { from: operator });
            });

            describe(`when 0-th layer2 has ${commissionRateSignStr} commission rate of ${commissionPercent}%`, function () {
              it(`the layer2 can commit next ${n} epochs`, async function () {
                await this._multiCommit(this.layer2s[i], n);
              });

              beforeEach(async function () {
                await this.seigManager.setCommissionRate(this.layer2s[i].address, commissionRate.toFixed(WTON_UNIT), isCommissionRateNegative);

                await Promise.all(this.layer2s.map(
                  layer2 => this._deposit(operator, layer2.address, operatorAmount.toFixed(WTON_UNIT)),
                ));
                depositBlock = await web3.eth.getBlockNumber();
              });

              describe('when the layer2 commits once', function () {
                it('exact amount of seig must be given to token owner and operator', async function () {
                  const layer2Addr = this.layer2s[i].address;

                  const {
                    operatorSeigs: expectedOperatorSeigs,
                    userSeigs: expectedTokenOwnerSeigs,
                  } = await expectedSeigs(this.seigManager, layer2Addr, tokenOwner1);

                  const beforeOperatorStake = await this.seigManager.stakeOf(layer2Addr, operator);
                  const beforeTokenOwnerStake = await this.seigManager.stakeOf(layer2Addr, tokenOwner1);

                  await this._commit(this.layer2s[i]);

                  const afterOperatorStake = await this.seigManager.stakeOf(layer2Addr, operator);
                  const afterTokenOwnerStake = await this.seigManager.stakeOf(layer2Addr, tokenOwner1);

                  /*console.log(`
                  beforeOperatorStake                 : ${beforeOperatorStake}
                  beforeTokenOwnerStake         : ${beforeTokenOwnerStake}

                  afterOperatorStake  : ${afterOperatorStake}
                  afterTokenOwnerStake                      : ${afterTokenOwnerStake}
                    `);*/

                  checkBalance(afterTokenOwnerStake.sub(beforeTokenOwnerStake), expectedTokenOwnerSeigs, WTON_UNIT);
                  checkBalance(afterOperatorStake.sub(beforeOperatorStake), expectedOperatorSeigs, WTON_UNIT);
                });
              });

              describe('when the layer2 commits multiple times', async function () {
                let beforeCoinageTotalSupply;
                let afterCoinageTotalSupply;

                let beforeOperatorStake;
                let afterOperatorStake;

                let beforeCommitBlock;
                let afterCommitBlock;

                beforeEach(async function () {
                  beforeCoinageTotalSupply = await this.coinages[i].totalSupply();
                  beforeOperatorStake = await this.seigManager.stakeOf(this.layer2s[i].address, operator);
                  beforeCommitBlock = await this.seigManager.lastCommitBlock(this.layer2s[i].address);

                  //console.log('beforeOperatorStake', toWTONString(beforeOperatorStake));

                  await this._multiCommit(this.layer2s[i], n);

                  afterCoinageTotalSupply = await this.coinages[i].totalSupply();
                  afterOperatorStake = await this.seigManager.stakeOf(this.layer2s[i].address, operator);
                  afterCommitBlock = await this.seigManager.lastCommitBlock(this.layer2s[i].address);

                  //console.log('afterOperatorStake', toWTONString(afterOperatorStake));
                });

                if (!isCommissionRateNegative) {
                  // if commission rate is positive
                  it(`operator should receive ${commissionPercent}% of seigniorages`, async function () {
                    const seigs = afterCoinageTotalSupply.sub(beforeCoinageTotalSupply);
                    const operatorSeigs = afterOperatorStake.sub(beforeOperatorStake);

                    const expectedOperatorSeigsWithoutCommission = _WTON(seigs, WTON_UNIT)
                      .times(operatorRateNr).div(1 + operatorRateNr);
                    const expectedCommission = _WTON(seigs, WTON_UNIT).minus(expectedOperatorSeigsWithoutCommission).times(commissionRate);

                    const expectedOperatorSeigs = expectedOperatorSeigsWithoutCommission.plus(expectedCommission);

                    expect(seigs).to.be.bignumber.gt('0');
                    checkBalance(operatorSeigs, expectedOperatorSeigs, WTON_UNIT);
                  });
                } else {
                  // if commission rate is negative
                  it(`operator should receive ${100 - commissionPercent}% of seigniorages`, async function () {
                    const seigs = afterCoinageTotalSupply.sub(beforeCoinageTotalSupply);
                    const operatorSeigs = afterOperatorStake.sub(beforeOperatorStake);

                    const expectedOperatorSeigsWithoutCommission = _WTON(seigs, WTON_UNIT)
                      .times(operatorRateNr).div(1 + operatorRateNr);
                    const expectedCommission = expectedOperatorSeigsWithoutCommission.times(commissionRate);

                    const expectedOperatorSeigs = expectedOperatorSeigsWithoutCommission.gte(expectedCommission)
                      ? expectedOperatorSeigsWithoutCommission.minus(expectedCommission)
                      : _WTON('0');

                    expect(seigs).to.be.bignumber.gt('0');
                    checkBalance(operatorSeigs, expectedOperatorSeigs, WTON_UNIT);
                  });
                }
              });
            });
          });
        }

        const operatorRates = [
          //_WTON('0'),
          _WTON('0.01'),
          /*_WTON('0.1'),
          _WTON('0.3'),
          _WTON('0.5'),
          _WTON('0.8'),
          _WTON('1'),
          _WTON('1.5'),
          _WTON('2'),
          _WTON('10'),
          _WTON('100'),*/
        ];

        const commissionRates = [
          //_WTON('0.0'),
          _WTON('0.1'),
          /*_WTON('0.3'),
          _WTON('0.5'),
          _WTON('0.9'),
          _WTON('0.99'),
          _WTON('1.0'),*/
        ];

        const isCommissionRateNegatives = [
          //false,
          true,
        ];

        operatorRates.forEach(or => commissionRates.forEach(cr => isCommissionRateNegatives.forEach(ng => behaveWithCommissionRate.call(this, or, cr, ng))));
      });
    });
  });

  describe('when 2 token owners deposit to each layer2s', async function () {
    beforeEach(async function () {
      await Promise.all([tokenOwner1, tokenOwner2].map(async (tokenOwner) => {
        await this.wton.swapFromTONAndTransfer(tokenOwner, tokenOwnerInitialBalance.toFixed(TON_UNIT));
        await this.wton.approve(this.depositManager.address, tokenOwnerInitialBalance.toFixed(WTON_UNIT), { from: tokenOwner });
      }));
    });

    function behaveWhenTokensAreConcentratedOnOneSide (commissionRate, isCommissionRateNegative) {
      const commissionPercent = commissionRate.toNumber() * 100;
      const commissionRateSignStr = isCommissionRateNegative ? 'negative' : 'positive';

      describe(`when all layer2s have ${commissionRateSignStr} commission rate of ${commissionPercent}%`, function () {
        beforeEach(async function () {
          if (commissionPercent > 0) {
            await Promise.all(this.layer2s.map(
              layer2 => this.seigManager.setCommissionRate(layer2.address, commissionRate.toFixed(WTON_UNIT), isCommissionRateNegative),
            ));
          }
        });

        describe('when the first owner deposit 95% of his balance to 0-th layer2, and the second one deposits 5% of his balance', function () {
          const amount1 = tokenOwnerInitialBalance.div(20).times(19).div(NUM_ROOTCHAINS);
          const amount2 = tokenOwnerInitialBalance.div(20).div(NUM_ROOTCHAINS);

          beforeEach(async function () {
            await Promise.all(this.layer2s.map(layer2 => this._deposit(tokenOwner1, layer2.address, amount1.toFixed(WTON_UNIT))));
            await Promise.all(this.layer2s.map(layer2 => this._deposit(tokenOwner2, layer2.address, amount2.toFixed(WTON_UNIT))));
          });

          it('the first owner can make a withdraw request with all staked tokens', async function () {
            const from = tokenOwner1;

            await Promise.all(this.layer2s.map(async (layer2) => {
              const staked = await this.seigManager.stakeOf(layer2.address, from);

              await this.depositManager.requestWithdrawal(layer2.address, staked, { from });
            }));
          });

          it('the second owner can make a withdraw request with all staked tokens', async function () {
            const from = tokenOwner2;

            await Promise.all(this.layer2s.map(async (layer2) => {
              const staked = await this.seigManager.stakeOf(layer2.address, from);

              await this.depositManager.requestWithdrawal(layer2.address, staked, { from });
            }));
          });

          describe('when 0-th layer2 commits multiple times', function () {
            const i = 0;
            const n = 50;

            beforeEach(async function () {
              const layer2 = this.layer2s[i];
              await this._multiCommit(layer2, n);
            });

            it('the first owner can make a withdraw request with all staked tokens from all layer2s', async function () {
              const from = tokenOwner1;

              await Promise.all(this.layer2s.map(async (layer2, j) => {
                const staked = await this.seigManager.stakeOf(layer2.address, from);

                // NOTE: error found here
                await this.depositManager.requestWithdrawal(layer2.address, staked, { from });
              }));
            });

            it('the second owner can make a withdraw request with all staked tokens from all layer2s', async function () {
              const from = tokenOwner2;

              await Promise.all(this.layer2s.map(async (layer2, j) => {
                const staked = await this.seigManager.stakeOf(layer2.address, from);

                await this.depositManager.requestWithdrawal(layer2.address, staked, { from });
              }));
            });

            it('both owners can make withdraw requests with all staked tokens from all layer2s', async function () {
              await Promise.all(this.layer2s.map(async (layer2, j) => {
                const staked1 = await this.seigManager.stakeOf(layer2.address, tokenOwner1);
                const staked2 = await this.seigManager.stakeOf(layer2.address, tokenOwner2);

                await this.depositManager.requestWithdrawal(layer2.address, staked1, { from: tokenOwner1 });
                await this.depositManager.requestWithdrawal(layer2.address, staked2, { from: tokenOwner2 });
              }));
            });

            describe('when all layer2s commit multiple times', function () {
              beforeEach(async function () {
                for (const _ of range(10)) {
                  await Promise.all(range(10).map(async (_) => {
                    await time.advanceBlock();
                    await time.increase(time.duration.seconds(10));
                  }));

                  await Promise.all(this.layer2s.map((layer2) => this._multiCommit(layer2, 10)));
                }
              });

              it('both owners can make withdraw requests with all staked tokens from all layer2s', async function () {
                await Promise.all(this.layer2s.map(async (layer2, j) => {
                  const staked1 = await this.seigManager.stakeOf(layer2.address, tokenOwner1);
                  const staked2 = await this.seigManager.stakeOf(layer2.address, tokenOwner2);

                  await this.depositManager.requestWithdrawal(layer2.address, staked1, { from: tokenOwner1 });
                  await this.depositManager.requestWithdrawal(layer2.address, staked2, { from: tokenOwner2 });
                }));
              });
            });
          });
        });
      });
    }

    behaveWhenTokensAreConcentratedOnOneSide(_WTON('0.0'), false);
    behaveWhenTokensAreConcentratedOnOneSide(_WTON('0.3'), false);
    behaveWhenTokensAreConcentratedOnOneSide(_WTON('0.5'), false);
    behaveWhenTokensAreConcentratedOnOneSide(_WTON('0.6'), false);
    behaveWhenTokensAreConcentratedOnOneSide(_WTON('0.9'), false);
    behaveWhenTokensAreConcentratedOnOneSide(_WTON('1.0'), false);

    behaveWhenTokensAreConcentratedOnOneSide(_WTON('0.0'), true);
    behaveWhenTokensAreConcentratedOnOneSide(_WTON('0.3'), true);
    behaveWhenTokensAreConcentratedOnOneSide(_WTON('0.5'), true);
    behaveWhenTokensAreConcentratedOnOneSide(_WTON('0.6'), true);
    behaveWhenTokensAreConcentratedOnOneSide(_WTON('0.9'), true);
    behaveWhenTokensAreConcentratedOnOneSide(_WTON('1.0'), true);
  });
});
