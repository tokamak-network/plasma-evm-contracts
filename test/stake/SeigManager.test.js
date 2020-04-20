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
const RootChain = contract.fromArtifact('RootChain');
const EtherToken = contract.fromArtifact('EtherToken');

const DepositManager = contract.fromArtifact('DepositManager');
const SeigManager = contract.fromArtifact('SeigManager');
const RootChainRegistry = contract.fromArtifact('RootChainRegistry');
const CustomIncrementCoinage = contract.fromArtifact('CustomIncrementCoinage');
const PowerTON = contract.fromArtifact('PowerTON');

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

const e = web3.utils.toBN('1000000000'); // 1e9

const TON_UNIT = 'wei';
const WTON_UNIT = 'ray';
const WTON_TON_RATIO = _WTON_TON('1');

const [tokenOwner1, tokenOwner2] = accounts;
const operator = defaultSender;

const dummyStatesRoot = '0xdb431b544b2f5468e3f771d7843d9c5df3b4edcf8bc1c599f18f0b4ea8709bc3';
const dummyTransactionsRoot = '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421';
const dummyReceiptsRoot = '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421';

const TON_INITIAL_SUPPLY = _TON('100000');
const SEIG_PER_BLOCK = TON_INITIAL_SUPPLY.times(WTON_TON_RATIO).div(1000); // 100 (W)TON / block
const WITHDRAWAL_DELAY = 10;
const NUM_ROOTCHAINS = 4;

const tokenAmount = TON_INITIAL_SUPPLY.div(1000); // 100 TON
const tokenOwnerInitialBalance = tokenAmount.times(NUM_ROOTCHAINS); // 400 TON

const totalStakedAmount = tokenOwnerInitialBalance; // 400 TON
const totalUnstakedAmount = TON_INITIAL_SUPPLY.minus(tokenOwnerInitialBalance); // 99600 TON

const NRE_LENGTH = 2;

const ROUND_DURATION = time.duration.minutes(1);

const MAX_COMMISSION_RATE = _WTON('1.0');

class RootChainState {
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
   * @param {*} rootchain
   * @param {RootChainState} rootchainState
   */
  async function submitDummyNRE (rootchain, rootchainState) {
    const pos1 = makePos(rootchainState.currentFork, rootchainState.lastEpoch + 1);
    const pos2 = makePos(rootchainState.lastBlock + 1, rootchainState.lastBlock + rootchainState.NRE_LENGTH);

    rootchainState.lastEpoch += 2; // skip ORE
    rootchainState.lastBlock += rootchainState.NRE_LENGTH;

    const COST_NRB = await rootchain.COST_NRB();

    return rootchain.submitNRE(
      pos1,
      pos2,
      dummyStatesRoot,
      dummyTransactionsRoot,
      dummyReceiptsRoot,
      { value: COST_NRB },
    );
  }

  async function submitDummyNREs (rootchain, rootchainState, n) {
    for (const _ of range(n)) {
      await time.increase(time.duration.seconds(1));
      await submitDummyNRE(rootchain, rootchainState);
    }
  }

  // deploy contract and instances
  beforeEach(async function () {
    this.ton = await TON.new();
    this.wton = await WTON.new(this.ton.address);

    this.etherToken = await EtherToken.new(true, this.ton.address, true);

    const epochHandler = await EpochHandler.new();
    const submitHandler = await SubmitHandler.new(epochHandler.address);

    this.rootchains = await Promise.all(range(NUM_ROOTCHAINS).map(_ => RootChain.new(
      epochHandler.address,
      submitHandler.address,
      this.etherToken.address,
      development,
      NRE_LENGTH,
      dummyStatesRoot,
      dummyTransactionsRoot,
      dummyReceiptsRoot,
    )));

    // root chain state in local
    this.rootchainState = {};
    for (const rootchain of this.rootchains) {
      this.rootchainState[rootchain.address] = new RootChainState(NRE_LENGTH);
    }

    this.registry = await RootChainRegistry.new();

    this.depositManager = await DepositManager.new(
      this.wton.address,
      this.registry.address,
      WITHDRAWAL_DELAY,
    );

    this.seigManager = await SeigManager.new(
      this.ton.address,
      this.wton.address,
      this.registry.address,
      this.depositManager.address,
      SEIG_PER_BLOCK.toFixed(WTON_UNIT),
    );

    this.powerton = await PowerTON.new(
      this.seigManager.address,
      this.wton.address,
      ROUND_DURATION,
    );

    await this.powerton.init();

    await this.seigManager.setPowerTON(this.powerton.address);
    await this.powerton.start();

    // add minter roles
    await this.wton.addMinter(this.seigManager.address);
    await this.ton.addMinter(this.wton.address);

    // set seig manager to contracts
    await Promise.all([
      this.depositManager,
      this.wton,
    ].map(contract => contract.setSeigManager(this.seigManager.address)));
    await Promise.all(this.rootchains.map(rootchain => rootchain.setSeigManager(this.seigManager.address)));

    // register root chain and deploy coinage
    await Promise.all(this.rootchains.map(rootchain => this.registry.registerAndDeployCoinage(rootchain.address, this.seigManager.address)));

    // mint TON to accounts
    await this.ton.mint(operator, TON_INITIAL_SUPPLY.toFixed(TON_UNIT));
    await this.ton.approve(this.wton.address, TON_INITIAL_SUPPLY.toFixed(TON_UNIT));

    // load tot token and coinage tokens
    this.tot = await CustomIncrementCoinage.at(await this.seigManager.tot());
    const coinageAddrs = await Promise.all(
      this.rootchains.map(rootchain => this.seigManager.coinages(rootchain.address)),
    );

    this.coinages = [];
    this.coinagesByRootChain = {};
    for (const addr of coinageAddrs) {
      const i = coinageAddrs.findIndex(a => a === addr);
      this.coinages[i] = await CustomIncrementCoinage.at(addr);
      this.coinagesByRootChain[this.rootchains[i].address] = this.coinages[i];
    }

    // contract-call wrapper functions
    this._deposit = (from, to, amount) => this.depositManager.deposit(to, amount, { from });
    this._commit = (rootchain) => submitDummyNRE(rootchain, this.rootchainState[rootchain.address]);
    this._multiCommit = (rootchain, n) => submitDummyNREs(rootchain, this.rootchainState[rootchain.address], n);
  });

  describe('when the token owner are the only depositor of each root chain', function () {
    beforeEach(async function () {
      await this.wton.swapFromTONAndTransfer(tokenOwner1, tokenOwnerInitialBalance.toFixed(TON_UNIT));

      await this.wton.approve(this.depositManager.address, tokenOwnerInitialBalance.toFixed(WTON_UNIT), { from: tokenOwner1 });
    });

    describe('when the token owner equally deposit WTON to all root chains', function () {
      beforeEach(async function () {
        // deposit from the token owner
        this.receipts = await Promise.all(this.rootchains.map(
          rootchain => this._deposit(tokenOwner1, rootchain.address, tokenAmount.toFixed(WTON_UNIT)),
        ));
      });

      afterEach(function () {
        delete this.receipts;
      });

      it('should emit Deposited event', function () {
        this.receipts.forEach(({ logs }, i) => {
          const rootchain = this.rootchains[i];
          expectEvent.inLogs(logs, 'Deposited', {
            rootchain: rootchain.address,
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

      it('tot balance of root chain must be increased by deposited WTON amount', async function () {
        await Promise.all(this.rootchains.map(
          async (rootchain) => {
            expect(await this.tot.balanceOf(rootchain.address))
              .to.be.bignumber.equal(tokenAmount.toFixed(WTON_UNIT));
          },
        ));
      });

      // multiple root chains test
      for (const _i in range(NUM_ROOTCHAINS)) {
        const i = Number(_i);
        const indices = range(0, i + 1);
        const c = indices.map(i => `${i}-th`).join(', ');

        describe(`when ${c} root chains commits first ORE each`, function () {
          beforeEach(async function () {
            this.previousSeigBlock = await this.seigManager.lastSeigBlock();

            this.totBalancesAtCommit = {}; // track tot balance when root chain is comitted
            this.accSeig = _WTON('0');
            this.seigs = [];

            o = '';

            for (const i of indices) {
              const rootchain = this.rootchains[i];

              const sb0 = await this.seigManager.lastSeigBlock();
              const prevTotTotalSupply = await this.tot.totalSupply();

              const prevBalance = await this.tot.balanceOf(rootchain.address);

              await time.advanceBlock();
              await time.advanceBlock();
              await time.advanceBlock();
              const { tx } = await this._commit(rootchain);

              const sb1 = await this.seigManager.lastSeigBlock();
              const curTotTotalSupply = await this.tot.totalSupply();

              const curBalance = await this.tot.balanceOf(rootchain.address);

              this.totBalancesAtCommit[rootchain.address] = curBalance;

              const {
                args: {
                  totalStakedAmount: _totalStakedAmount,
                  totalSupplyOfWTON,
                  prevTotalSupply,
                  nextTotalSupply,
                },
              } = await expectEvent.inTransaction(tx, this.seigManager, 'CommitLog1');

              const { args: { totalSeig, stakedSeig, unstakedSeig, powertonSeig } } = await expectEvent.inTransaction(tx, this.seigManager, 'SeigGiven');

              const { args: { previous, current } } = await expectEvent.inTransaction(tx, this.tot, 'FactorSet');

              const seig = _WTON(stakedSeig, WTON_UNIT);

              checkBalance(curTotTotalSupply.sub(prevTotTotalSupply), seig, WTON_UNIT);

              this.seigs.push(seig);
              this.accSeig = this.accSeig.plus(seig);

              // test log....s
              const accSeigAtCommit = this.seigs.slice(0, i + 1).reduce((a, b) => a.plus(b));
              const accSeig = this.accSeig;

              o += `\n\n\n
    ${'-'.repeat(40)}
    ${i}-th root chain first commit
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
            it(`${i}-th root chain: check amount of total supply, balance, staked amount, uncomitted amount`, async function () {
              const rootchain = this.rootchains[i];

              const accSeigAtCommit = this.seigs.slice(0, i + 1).reduce((a, b) => a.plus(b));
              const balnceAtCommit = tokenAmount.times(WTON_TON_RATIO)
                .plus(accSeigAtCommit.div(NUM_ROOTCHAINS));

              const accSeig = this.accSeig;
              const balanceAtCurrent = tokenAmount.times(WTON_TON_RATIO)
                .plus(accSeig.div(NUM_ROOTCHAINS));

              // tot balance of a root chain
              checkBalance(
                this.totBalancesAtCommit[rootchain.address],
                balnceAtCommit,
                WTON_UNIT,
              );

              // coinage total supply
              checkBalance(
                await this.coinagesByRootChain[rootchain.address].totalSupply(),
                balnceAtCommit,
                WTON_UNIT,
              );

              // coinage balance of the tokwn owner
              checkBalance(
                await this.coinagesByRootChain[rootchain.address].balanceOf(tokenOwner1),
                balnceAtCommit,
                WTON_UNIT,
              );

              // staked amount of the token owner
              checkBalance(
                await this.seigManager.stakeOf(rootchain.address, tokenOwner1),
                balnceAtCommit,
                WTON_UNIT,
              );

              // uncomitted amount of the tokwn owner
              checkBalance(
                await this.seigManager.uncomittedStakeOf(rootchain.address, tokenOwner1),
                balanceAtCurrent.minus(balnceAtCommit),
                WTON_UNIT,
              );
            });

            it(`${i}-th root chain: the tokwn owner should claim staked amount`, async function () {
              const rootchain = this.rootchains[i];
              const coinage = this.coinagesByRootChain[rootchain.address];

              const precomitted = toBN(
                (
                  this.seigs.slice(i + 1).length > 0
                    ? this.seigs.slice(i + 1).reduce((a, b) => a.plus(b)).div(NUM_ROOTCHAINS)
                    : _WTON('0')
                ).toFixed(WTON_UNIT),
              );
              const amount = await this.seigManager.stakeOf(rootchain.address, tokenOwner1);
              const additionalTotBurnAmount = await this.seigManager.additionalTotBurnAmount(rootchain.address, tokenOwner1, amount);

              // console.log(`
              // amount                     ${amount.toString(10).padStart(30)}
              // precomitted                ${precomitted.toString(10).padStart(30)}
              // additionalTotBurnAmount    ${additionalTotBurnAmount.toString(10).padStart(30)}
              // `);

              const prevWTONBalance = await this.wton.balanceOf(tokenOwner1);
              const prevCoinageTotalSupply = await coinage.totalSupply();
              const prevCoinageBalance = await coinage.balanceOf(tokenOwner1);
              const prevTotTotalSupply = await this.tot.totalSupply();
              const prevTotBalance = await this.tot.balanceOf(rootchain.address);

              // 1. make a withdrawal request
              expect(await this.depositManager.pendingUnstaked(rootchain.address, tokenOwner1)).to.be.bignumber.equal('0');
              expect(await this.depositManager.accUnstaked(rootchain.address, tokenOwner1)).to.be.bignumber.equal('0');

              const tx = await this.depositManager.requestWithdrawal(rootchain.address, amount, { from: tokenOwner1 });

              expectEvent.inLogs(
                tx.logs,
                'WithdrawalRequested',
                {
                  rootchain: rootchain.address,
                  depositor: tokenOwner1,
                  amount: amount,
                },
              );

              const { args: { coinageBurnAmount, totBurnAmount } } = await expectEvent.inTransaction(tx.tx, this.seigManager, 'UnstakeLog');

              // console.log('coinageBurnAmount  ', coinageBurnAmount.toString(10).padStart(35));
              // console.log('totBurnAmount      ', totBurnAmount.toString(10).padStart(35));
              // console.log('diff               ', toBN(totBurnAmount).sub(toBN(coinageBurnAmount)).toString(10).padStart(35));

              expect(await this.depositManager.pendingUnstaked(rootchain.address, tokenOwner1)).to.be.bignumber.equal(amount);
              expect(await this.depositManager.accUnstaked(rootchain.address, tokenOwner1)).to.be.bignumber.equal('0');

              // 2. process the request
              await expectRevert(this.depositManager.processRequest(rootchain.address, false, { from: tokenOwner1 }), 'DepositManager: wait for withdrawal delay');

              await Promise.all(range(WITHDRAWAL_DELAY + 1).map(_ => time.advanceBlock()));

              expectEvent(
                await this.depositManager.processRequest(rootchain.address, false, { from: tokenOwner1 }),
                'WithdrawalProcessed',
                {
                  rootchain: rootchain.address,
                  depositor: tokenOwner1,
                  amount: amount,
                },
              );

              expect(await this.depositManager.pendingUnstaked(rootchain.address, tokenOwner1)).to.be.bignumber.equal('0');
              expect(await this.depositManager.accUnstaked(rootchain.address, tokenOwner1)).to.be.bignumber.equal(amount);

              const curWTONBalance = await this.wton.balanceOf(tokenOwner1);
              const curCoinageTotalSupply = await coinage.totalSupply();
              const curCoinageBalance = await coinage.balanceOf(tokenOwner1);
              const curTotTotalSupply = await this.tot.totalSupply();
              const curTotBalance = await this.tot.balanceOf(rootchain.address);

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

      describe('when 0-th root chain commits 10 times', function () {
        const i = 0;
        const n = 10;

        beforeEach(async function () {
          this.accSeig = _WTON('0');

          this.seigBlocks = [];
          this.totTotalSupplies = [];

          for (const _ of range(n)) {
            this.seigBlocks.push(await this.seigManager.lastSeigBlock());
            this.totTotalSupplies.push(await this.tot.totalSupply());
            await this._commit(this.rootchains[i]);
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

        it('should mint correct seigniorages for each commit', async function () {
          for (const j of range(this.seigBlocks.length - 1)) { // for j-th commit
            const nBlocks = this.seigBlocks[j + 1].sub(this.seigBlocks[j]);
            const accSeigBeforeCommit = this.accSeigs[j].minus(this.seigs[j]);

            const totalStaked = tokenAmount.times(WTON_TON_RATIO)
              .times(NUM_ROOTCHAINS)
              .plus(accSeigBeforeCommit);
            const totTotalSupplyBeforeCommit = TON_INITIAL_SUPPLY.times(WTON_TON_RATIO)
              .plus(accSeigBeforeCommit);

            const expectedSeig = SEIG_PER_BLOCK
              .times(nBlocks)
              .times(totalStaked)
              .div(totTotalSupplyBeforeCommit);

            // console.log(`
            // ${j}-th commit
            // this.accSeigs[j]              ${this.accSeigs[j].toString(10).padStart(40)}
            // this.seigs[j]                 ${this.seigs[j].toString(10).padStart(40)}

            // nBlocks                       ${nBlocks.toString(10).padStart(40)}
            // accSeigBeforeCommit           ${accSeigBeforeCommit.toString().padStart(40)}
            // totalStaked:                  ${totalStaked.toString().padStart(40)}
            // totTotalSupplyBeforeCommit:   ${totTotalSupplyBeforeCommit.toString().padStart(40)}
            // expectedSeig:                 ${expectedSeig.toString().padStart(40)}
            // this.seigs[j]:                ${this.seigs[j].toString().padStart(40)}
            // ${'-'.repeat(50)}
            // `);

            checkBalance(
              toBN(this.seigs[j].toFixed(WTON_UNIT)),
              expectedSeig,
              WTON_UNIT,
            );
          }
        });

        it(`${i}-th root chain: check amount of total supply, balance, staked amount`, async function () {
          const rootchain = this.rootchains[i];

          const expected = tokenAmount.times(WTON_TON_RATIO).plus(this.accSeig.div(4)); // actually not .div(4)...

          // tot total supply is checked in previous test.

          // coinage total supply
          checkBalance(
            await this.coinagesByRootChain[rootchain.address].totalSupply(),
            expected,
            WTON_UNIT,
          );

          // coinage balance of the tokwn owner
          checkBalance(
            await this.coinagesByRootChain[rootchain.address].balanceOf(tokenOwner1),
            expected,
            WTON_UNIT,
          );

          // staked amount of the token owner
          checkBalance(
            await this.seigManager.stakeOf(rootchain.address, tokenOwner1),
            expected,
            WTON_UNIT,
          );
        });

        describe('when the token holder tries to withdraw all stakes', function () {
          let wtonAmount;

          beforeEach(async function () {
            wtonAmount = await this.seigManager.stakeOf(this.rootchains[i].address, tokenOwner1);
          });

          it('should withdraw', async function () {
            const tokenOwnerWtonBalance0 = await this.wton.balanceOf(tokenOwner1);
            const depositManagerWtonBalance0 = await this.wton.balanceOf(this.depositManager.address);

            await this.depositManager.requestWithdrawal(this.rootchains[i].address, wtonAmount, { from: tokenOwner1 });

            await Promise.all(range(WITHDRAWAL_DELAY + 1).map(_ => time.advanceBlock()));

            await this.depositManager.processRequest(this.rootchains[i].address, false, { from: tokenOwner1 });

            const tokenOwnerWtonBalance1 = await this.wton.balanceOf(tokenOwner1);
            const depositManagerWtonBalance1 = await this.wton.balanceOf(this.depositManager.address);

            expect(depositManagerWtonBalance1.sub(depositManagerWtonBalance0).neg()).to.be.bignumber.equal(wtonAmount);
            expect(tokenOwnerWtonBalance1.sub(tokenOwnerWtonBalance0)).to.be.bignumber.equal(wtonAmount);
          });

          it('should re-deposit', async function () {
            const tokenOwnerWtonBalance0 = await this.wton.balanceOf(tokenOwner1);
            const depositManagerWtonBalance0 = await this.wton.balanceOf(this.depositManager.address);

            await this.depositManager.requestWithdrawal(this.rootchains[i].address, wtonAmount, { from: tokenOwner1 });

            await Promise.all(range(WITHDRAWAL_DELAY + 1).map(_ => time.advanceBlock()));

            await this.depositManager.redeposit(this.rootchains[i].address, { from: tokenOwner1 });

            const tokenOwnerWtonBalance1 = await this.wton.balanceOf(tokenOwner1);
            const depositManagerWtonBalance1 = await this.wton.balanceOf(this.depositManager.address);

            expect(depositManagerWtonBalance1).to.be.bignumber.equal(depositManagerWtonBalance0);
            expect(tokenOwnerWtonBalance1).to.be.bignumber.equal(tokenOwnerWtonBalance0);
          });

          describe('after the token holder withdraw all stakes in TON', function () {
            let tonAmount;

            beforeEach(async function () {
              await this.depositManager.requestWithdrawal(this.rootchains[i].address, wtonAmount, { from: tokenOwner1 });

              await Promise.all(range(WITHDRAWAL_DELAY + 1).map(_ => time.advanceBlock()));

              const tonBalance0 = await this.ton.balanceOf(tokenOwner1);
              await this.depositManager.processRequest(this.rootchains[i].address, true, { from: tokenOwner1 });
              const tonBalance1 = await this.ton.balanceOf(tokenOwner1);

              tonAmount = tonBalance1.sub(tonBalance0);
            });

            it('the root chain can commit next epochs', async function () {
              await this._multiCommit(this.rootchains[i], 10);
            });

            it('the token holder can deposit again', async function () {
              const data = marshalString(
                [this.depositManager.address, this.rootchains[i].address]
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

            describe('after the root chain commits 10 epochs', function () {
              beforeEach(async function () {
                await this._multiCommit(this.rootchains[i], 10);
              });

              it('the token holder can deposit again', async function () {
                const data = marshalString(
                  [this.depositManager.address, this.rootchains[i].address]
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
              await this.depositManager.requestWithdrawal(this.rootchains[i].address, wtonAmount, { from: tokenOwner1 });
            });

            it('the token owner can re-deposit', async function () {
              const tx = await this.depositManager.redeposit(this.rootchains[i].address, { from: tokenOwner1 });

              expectEvent.inLogs(tx.logs, 'Deposited', {
                rootchain: this.rootchains[i].address,
                depositor: tokenOwner1,
                amount: wtonAmount,
              });
            });

            describe('after the token holder withdraw all stakes in WTON', function () {
              beforeEach(async function () {
                await Promise.all(range(WITHDRAWAL_DELAY + 1).map(_ => time.advanceBlock()));

                await this.depositManager.processRequest(this.rootchains[i].address, false, { from: tokenOwner1 });
              });

              it('the root chain can commit next epochs', async function () {
                await Promise.all(range(10).map(_ => this._commit(this.rootchains[i])));
              });

              it('the token holder can deposit again', async function () {
                await this.wton.approve(this.depositManager.address, wtonAmount, { from: tokenOwner1 });
                await this._deposit(tokenOwner1, this.rootchains[i].address, wtonAmount);
              });

              describe('after the root chain commits 10 epochs', function () {
                beforeEach(async function () {
                  await Promise.all(range(10).map(_ => this._commit(this.rootchains[i])));
                });

                it('the token holder can deposit again', async function () {
                  await this.wton.approve(this.depositManager.address, wtonAmount, { from: tokenOwner1 });
                  await this._deposit(tokenOwner1, this.rootchains[i].address, wtonAmount);
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
            amount = (await this.seigManager.stakeOf(this.rootchains[i].address, tokenOwner1)).div(nBN);
          });

          it('should withdraw', async function () {
            const tokenOwnerWtonBalance0 = await this.wton.balanceOf(tokenOwner1);
            const depositManagerWtonBalance0 = await this.wton.balanceOf(this.depositManager.address);

            await Promise.all(range(n).map(_ => this.depositManager.requestWithdrawal(this.rootchains[i].address, amount, { from: tokenOwner1 })));

            await Promise.all(range(WITHDRAWAL_DELAY + 1).map(_ => time.advanceBlock()));

            await Promise.all(range(n).map(_ => this.depositManager.processRequest(this.rootchains[i].address, false, { from: tokenOwner1 })));

            const tokenOwnerWtonBalance1 = await this.wton.balanceOf(tokenOwner1);
            const depositManagerWtonBalance1 = await this.wton.balanceOf(this.depositManager.address);

            expect(depositManagerWtonBalance1.sub(depositManagerWtonBalance0).neg()).to.be.bignumber.equal(amount.mul(nBN));
            expect(tokenOwnerWtonBalance1.sub(tokenOwnerWtonBalance0)).to.be.bignumber.equal(amount.mul(nBN));
          });

          it('should re-deposit', async function () {
            const tokenOwnerWtonBalance0 = await this.wton.balanceOf(tokenOwner1);
            const depositManagerWtonBalance0 = await this.wton.balanceOf(this.depositManager.address);

            await Promise.all(range(n).map(_ => this.depositManager.requestWithdrawal(this.rootchains[i].address, amount, { from: tokenOwner1 })));

            await Promise.all(range(WITHDRAWAL_DELAY + 1).map(_ => time.advanceBlock()));

            await Promise.all(range(n).map(_ => this.depositManager.redeposit(this.rootchains[i].address, { from: tokenOwner1 })));

            const tokenOwnerWtonBalance1 = await this.wton.balanceOf(tokenOwner1);
            const depositManagerWtonBalance1 = await this.wton.balanceOf(this.depositManager.address);

            expect(depositManagerWtonBalance1).to.be.bignumber.equal(depositManagerWtonBalance0);
            expect(tokenOwnerWtonBalance1).to.be.bignumber.equal(tokenOwnerWtonBalance0);
          });
        });

        function behaveWhenPausedOrNot () {
          it('commit should not be reverted', async function () {
            await this._commit(this.rootchains[i]);
          });

          it('deposit should not be reverted', async function () {
            const from = tokenOwner1;
            const balance = (await this.wton.balanceOf(from)).div(toBN(NUM_ROOTCHAINS));
            await Promise.all(this.rootchains.map(
              (rootchain) =>
                this._deposit(from, rootchain.address, balance),
            ));
          });

          it('withdrawal should not be reverted', async function () {
            await Promise.all(
              this.rootchains.map(async (rootchain) => {
                const staked = await this.seigManager.stakeOf(rootchain.address, tokenOwner1);
                if (staked.cmp(toBN('0')) > 0) {
                  return this.depositManager.requestWithdrawal(rootchain.address, staked, { from: tokenOwner1 });
                }
              }),
            );

            await Promise.all(range(WITHDRAWAL_DELAY + 1).map(_ => time.advanceBlock()));

            await Promise.all(
              this.rootchains.map(async (rootchain) => {
                const numPendingRequests = await this.depositManager.numPendingRequests(rootchain.address, tokenOwner1);

                if (numPendingRequests.cmp(toBN('0')) > 0) {
                  await this.depositManager.processRequests(rootchain.address, numPendingRequests, false, { from: tokenOwner1 });
                }

                const staked = await this.seigManager.stakeOf(rootchain.address, tokenOwner1);
                expect(staked).to.be.bignumber.equal('0');
              }),
            );
          });
        }

        describe('after seig manager is paused', function () {
          const NUM_WITHDRAWN_ROOTCHAINS = Math.floor(NUM_ROOTCHAINS / 2);

          async function makeWithdrawalRequest (n) {
            await Promise.all(
              this.rootchains.slice(0, n).map(async (rootchain) => {
                const staked = await this.seigManager.stakeOf(rootchain.address, tokenOwner1);
                const amount = staked.div(toBN(2));
                if (amount.cmp(toBN('0')) > 0) {
                  return this.depositManager.requestWithdrawal(rootchain.address, amount, { from: tokenOwner1 });
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
            await this._commit(this.rootchains[i]);
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
              await this._commit(this.rootchains[i]);
              const totTotalSupply2 = await this.tot.totalSupply();

              expect(totTotalSupply2).to.be.bignumber.gt(totTotalSupply1);
            });

            behaveWhenPausedOrNot();
          });
        });
      });

      describe('when 0-th root chain changes commission rate with operator deposit', function () {
        const i = 0;
        const n = 1;

        function behaveWithCommissionRate (operatorRate, commissionRate, isCommissionRateNegative) {
          const operatorRateNr = operatorRate.toNumber();
          const commissionPercent = commissionRate.toNumber() * 100;
          const commissionRateSignStr = isCommissionRateNegative ? 'negative' : 'positive';

          describe(`when the operator deposits ${operatorRateNr} times as much as the token owner did`, function () {
            beforeEach(async function () {
              if (operatorRateNr === 0) return;

              const operatorAmount = tokenAmount.times(operatorRateNr);
              await this.wton.swapFromTONAndTransfer(operator, operatorAmount.times(NUM_ROOTCHAINS).toFixed(TON_UNIT));
              await this.wton.approve(this.depositManager.address, operatorAmount.times(NUM_ROOTCHAINS).toFixed(WTON_UNIT), { from: operator });

              await Promise.all(this.rootchains.map(
                rootchain => this._deposit(operator, rootchain.address, operatorAmount.toFixed(WTON_UNIT)),
              ));
            });

            describe(`when 0-th root chain has ${commissionRateSignStr} commission rate of ${commissionPercent}%`, function () {
              it(`the root chain can commit next ${n} epochs`, async function () {
                await this._multiCommit(this.rootchains[i], n);
              });

              beforeEach(async function () {
                await this.seigManager.setCommissionRate(this.rootchains[i].address, commissionRate.toFixed(WTON_UNIT), isCommissionRateNegative);
              });

              describe('when the root chain commits', async function () {
                let beforeCoinageTotalSupply;
                let afterCoinageTotalSupply;

                let beforeOperatorStake;
                let afterOperatorStake;

                let beforeCommitBlock;
                let afterCommitBlock;

                beforeEach(async function () {
                  beforeCoinageTotalSupply = await this.coinages[i].totalSupply();
                  beforeOperatorStake = await this.seigManager.stakeOf(this.rootchains[i].address, operator);
                  beforeCommitBlock = await this.seigManager.lastCommitBlock(this.rootchains[i].address);

                  console.log('beforeOperatorStake', toWTONString(beforeOperatorStake));

                  await this._multiCommit(this.rootchains[i], n);

                  afterCoinageTotalSupply = await this.coinages[i].totalSupply();
                  afterOperatorStake = await this.seigManager.stakeOf(this.rootchains[i].address, operator);
                  afterCommitBlock = await this.seigManager.lastCommitBlock(this.rootchains[i].address);

                  console.log('afterOperatorStake', toWTONString(afterOperatorStake));
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

                    console.log(`
        seigs                 : ${toWTONString(seigs, 10)}
        operatorSeigs         : ${toWTONString(operatorSeigs, 10)}

        expectedOperatorSeigsWithoutCommission  : ${expectedOperatorSeigsWithoutCommission.toString(10)}
        expectedCommission                      : ${expectedCommission.toString(10)}
        expectedOperatorSeigs                   : ${expectedOperatorSeigs.toString(10)}

        MAX_COMMISSION_RATE   : ${MAX_COMMISSION_RATE.toString(10)}
        commissionRate        : ${commissionRate.toString(10)}
        MAX_COMMISSION_RATE.plus(commissionRate)       : ${MAX_COMMISSION_RATE.plus(commissionRate).toString(10)}
                    `);

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

                    console.log(`
        seigs                 : ${toWTONString(seigs, 10)}
        operatorSeigs         : ${toWTONString(operatorSeigs, 10)}

        expectedOperatorSeigsWithoutCommission  : ${expectedOperatorSeigsWithoutCommission.toString(10)}
        expectedCommission                      : ${expectedCommission.toString(10)}
        expectedOperatorSeigs                   : ${expectedOperatorSeigs.toString(10)}

        MAX_COMMISSION_RATE   : ${MAX_COMMISSION_RATE.toString(10)}
        commissionRate        : ${commissionRate.toString(10)}
        MAX_COMMISSION_RATE.minus(commissionRate)       : ${MAX_COMMISSION_RATE.minus(commissionRate).toString(10)}
                    `);

                    expect(seigs).to.be.bignumber.gt('0');
                    checkBalance(operatorSeigs, expectedOperatorSeigs, WTON_UNIT);
                  });
                }
              });
            });
          });
        }

        const operatorRates = [
          _WTON('0'),
          _WTON('0.01'),
          _WTON('0.1'),
          _WTON('0.3'),
          _WTON('0.5'),
          _WTON('0.8'),
          _WTON('1'),
          _WTON('1.5'),
          _WTON('2'),
          _WTON('10'),
          _WTON('100'),
        ];

        const commissionRates = [
          _WTON('0.0'),
          _WTON('0.1'),
          _WTON('0.3'),
          _WTON('0.5'),
          _WTON('0.9'),
          _WTON('0.99'),
          _WTON('1.0'),
        ];

        const isCommissionRateNegatives = [
          false,
          true,
        ];

        operatorRates.forEach(or => commissionRates.forEach(cr => isCommissionRateNegatives.forEach(ng => behaveWithCommissionRate.call(this, or, cr, ng))));
      });
    });
  });

  describe('when 2 token owners deposit to each root chains', async function () {
    beforeEach(async function () {
      await Promise.all([tokenOwner1, tokenOwner2].map(async (tokenOwner) => {
        await this.wton.swapFromTONAndTransfer(tokenOwner, tokenOwnerInitialBalance.toFixed(TON_UNIT));
        await this.wton.approve(this.depositManager.address, tokenOwnerInitialBalance.toFixed(WTON_UNIT), { from: tokenOwner });
      }));
    });

    function behaveWhenTokensAreConcentratedOnOneSide (commissionRate, isCommissionRateNegative) {
      const commissionPercent = commissionRate.toNumber() * 100;
      const commissionRateSignStr = isCommissionRateNegative ? 'negative' : 'positive';

      describe(`when all root chains have ${commissionRateSignStr} commission rate of ${commissionPercent}%`, function () {
        beforeEach(async function () {
          if (commissionPercent > 0) {
            await Promise.all(this.rootchains.map(
              rootchain => this.seigManager.setCommissionRate(rootchain.address, commissionRate.toFixed(WTON_UNIT), isCommissionRateNegative),
            ));
          }
        });

        describe('when the first owner deposit 95% of his balance to 0-th root chain, and the second one deposits 5% of his balance', function () {
          const amount1 = tokenOwnerInitialBalance.div(20).times(19).div(NUM_ROOTCHAINS);
          const amount2 = tokenOwnerInitialBalance.div(20).div(NUM_ROOTCHAINS);

          beforeEach(async function () {
            await Promise.all(this.rootchains.map(rootchain => this._deposit(tokenOwner1, rootchain.address, amount1.toFixed(WTON_UNIT))));
            await Promise.all(this.rootchains.map(rootchain => this._deposit(tokenOwner2, rootchain.address, amount2.toFixed(WTON_UNIT))));
          });

          it('the first owner can make a withdraw request with all staked tokens', async function () {
            const from = tokenOwner1;

            await Promise.all(this.rootchains.map(async (rootchain) => {
              const staked = await this.seigManager.stakeOf(rootchain.address, from);

              await this.depositManager.requestWithdrawal(rootchain.address, staked, { from });
            }));
          });

          it('the second owner can make a withdraw request with all staked tokens', async function () {
            const from = tokenOwner2;

            await Promise.all(this.rootchains.map(async (rootchain) => {
              const staked = await this.seigManager.stakeOf(rootchain.address, from);

              await this.depositManager.requestWithdrawal(rootchain.address, staked, { from });
            }));
          });

          describe('when 0-th root chain commits multiple times', function () {
            const i = 0;
            const n = 50;

            beforeEach(async function () {
              const rootchain = this.rootchains[i];
              await this._multiCommit(rootchain, n);
            });

            it('the first owner can make a withdraw request with all staked tokens from all root chains', async function () {
              const from = tokenOwner1;

              await Promise.all(this.rootchains.map(async (rootchain, j) => {
                const staked = await this.seigManager.stakeOf(rootchain.address, from);

                // NOTE: error found here
                await this.depositManager.requestWithdrawal(rootchain.address, staked, { from });
              }));
            });

            it('the second owner can make a withdraw request with all staked tokens from all root chains', async function () {
              const from = tokenOwner2;

              await Promise.all(this.rootchains.map(async (rootchain, j) => {
                const staked = await this.seigManager.stakeOf(rootchain.address, from);

                await this.depositManager.requestWithdrawal(rootchain.address, staked, { from });
              }));
            });

            it('both owners can make withdraw requests with all staked tokens from all root chains', async function () {
              await Promise.all(this.rootchains.map(async (rootchain, j) => {
                const staked1 = await this.seigManager.stakeOf(rootchain.address, tokenOwner1);
                const staked2 = await this.seigManager.stakeOf(rootchain.address, tokenOwner2);

                await this.depositManager.requestWithdrawal(rootchain.address, staked1, { from: tokenOwner1 });
                await this.depositManager.requestWithdrawal(rootchain.address, staked2, { from: tokenOwner2 });
              }));
            });

            describe('when all root chains commit multiple times', function () {
              beforeEach(async function () {
                for (const _ of range(10)) {
                  await Promise.all(range(10).map(async (_) => {
                    await time.advanceBlock();
                    await time.increase(time.duration.seconds(10));
                  }));

                  await Promise.all(this.rootchains.map((rootchain) => this._multiCommit(rootchain, 10)));
                }
              });

              it('both owners can make withdraw requests with all staked tokens from all root chains', async function () {
                await Promise.all(this.rootchains.map(async (rootchain, j) => {
                  const staked1 = await this.seigManager.stakeOf(rootchain.address, tokenOwner1);
                  const staked2 = await this.seigManager.stakeOf(rootchain.address, tokenOwner2);

                  await this.depositManager.requestWithdrawal(rootchain.address, staked1, { from: tokenOwner1 });
                  await this.depositManager.requestWithdrawal(rootchain.address, staked2, { from: tokenOwner2 });
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
