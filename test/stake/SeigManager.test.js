const range = require('lodash/range');

const { createCurrency, createCurrencyRatio } = require('@makerdao/currency');
const {
  defaultSender, accounts, contract, web3,
} = require('@openzeppelin/test-environment');
const {
  BN, constants, expectEvent, expectRevert, time, ether,
} = require('@openzeppelin/test-helpers');

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

const chai = require('chai');
const { expect } = chai;
chai.use(require('chai-bn')(BN))
  .should();

const toBN = web3.utils.toBN;
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

const [operator, tokenOwner] = accounts;

const dummyStatesRoot = '0xdb431b544b2f5468e3f771d7843d9c5df3b4edcf8bc1c599f18f0b4ea8709bc3';
const dummyTransactionsRoot = '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421';
const dummyReceiptsRoot = '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421';

const TON_INITIAL_SUPPLY = _TON('10000');
const SEIG_PER_BLOCK = TON_INITIAL_SUPPLY.times(WTON_TON_RATIO).div(100); // 100 (W)TON / block
const WITHDRAWAL_DELAY = 10;
const NUM_ROOTCHAINS = 4;

const tokenAmount = TON_INITIAL_SUPPLY.div(100); // 100 TON
const tokwnOwnerInitialBalance = tokenAmount.times(NUM_ROOTCHAINS);

const totalStakedAmount = tokwnOwnerInitialBalance; // 400 TON
const totalUnstakedAmount = TON_INITIAL_SUPPLY.minus(tokwnOwnerInitialBalance); // 9600 TON

const NRE_LENGTH = 2;

class RootChainState {
  constructor (NRE_LENGTH) {
    this.currentFork = 0;
    this.lastEpoch = 0;
    this.lastBlock = 0;
    this.NRE_LENGTH = Number(NRE_LENGTH);
  }
}

describe.only('stake/SeigManager', function () {
  function makePos (v1, v2) { return toBN(v1).shln(128).add(toBN(v2)); }

  async function checkBalanceProm (balanceProm, expected, unit) {
    return checkBalance(await balanceProm, expected, unit);
  }

  function checkBalance (balanceBN, expected, unit) {
    const v = balanceBN.sub(toBN(expected.toFixed(unit))).abs();
    if (v.cmp(e) > 0) {
      console.error(`
        actual   : ${balanceBN.toString().padStart(40)}
        expected : ${expected.toFixed(unit).padStart(40)}
        diff     : ${v.toString().padStart(40)}
        e        : ${e.toString().padStart(40)}

      `);
    }
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

    // add WSTON minter role to seig manager
    await this.wton.addMinter(this.seigManager.address);

    // set seig manager to contracts
    await Promise.all([
      this.depositManager,
      this.ton,
      this.wton,
    ].map(contract => contract.setSeigManager(this.seigManager.address)));
    await Promise.all(this.rootchains.map(rootchain => rootchain.setSeigManager(this.seigManager.address)));

    // register root chain and deploy coinage
    await Promise.all(this.rootchains.map(rootchain => this.registry.registerAndDeployCoinage(rootchain.address, this.seigManager.address)));

    // mint TON to accounts
    await this.ton.mint(defaultSender, TON_INITIAL_SUPPLY.toFixed(TON_UNIT));
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
  });

  describe('when the token owner is the only depositor of each root chain', function () {
    beforeEach(async function () {
      await this.wton.swapFromTONAndTransfer(tokenOwner, tokwnOwnerInitialBalance.toFixed(TON_UNIT));
      await this.wton.approve(this.depositManager.address, tokwnOwnerInitialBalance.toFixed(WTON_UNIT), { from: tokenOwner });
    });

    describe('when the token owner deposits WTON to all root chains', function () {
      beforeEach(async function () {
        this.receipts = await Promise.all(this.rootchains.map(
          rootchain => this._deposit(tokenOwner, rootchain.address, tokenAmount.toFixed(WTON_UNIT)),
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
            depositor: tokenOwner,
            amount: tokenAmount.toFixed(WTON_UNIT),
          });
        });
      });

      it('WTON balance of the token owner must be zero', async function () {
        expect(await this.wton.balanceOf(tokenOwner)).to.be.bignumber.equal('0');
      });

      it('deposit manager should have deposited WTON tokens', async function () {
        expect(await this.wton.balanceOf(this.depositManager.address)).to.be.bignumber.equal(tokenAmount.times(NUM_ROOTCHAINS).toFixed(WTON_UNIT));
      });

      it('coinage balance of the tokwn owner must be increased by deposited WTON amount', async function () {
        for (const coinage of this.coinages) {
          expect(await coinage.balanceOf(tokenOwner)).to.be.bignumber.equal(tokenAmount.toFixed(WTON_UNIT));
        }
      });

      it('tot balance of root chain must be increased by deposited WTON amount', async function () {
        for (const rootchain of this.rootchains) {
          expect(await this.tot.balanceOf(rootchain.address)).to.be.bignumber.equal(tokenAmount.toFixed(WTON_UNIT));
        }
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

              const { args: { totalStakedAmount: _totalStakedAmount, totalSupplyOfWTON, prevTotalSupply, nextTotalSupply } } = await expectEvent.inTransaction(tx, this.seigManager, 'CommitLog1');

              const { args: { totalSeig, stakedSeig, unstakedSeig } } = await expectEvent.inTransaction(tx, this.seigManager, 'SeigGiven');

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
                await this.coinagesByRootChain[rootchain.address].balanceOf(tokenOwner),
                balnceAtCommit,
                WTON_UNIT,
              );

              // staked amount of the token owner
              checkBalance(
                await this.seigManager.stakeOf(rootchain.address, tokenOwner),
                balnceAtCommit,
                WTON_UNIT,
              );

              // uncomitted amount of the tokwn owner
              checkBalance(
                await this.seigManager.uncomittedStakeOf(rootchain.address, tokenOwner),
                balanceAtCurrent.minus(balnceAtCommit),
                WTON_UNIT,
              );
            });

            it.only(`${i}-th root chain: the tokwn owner should claim staked amount`, async function () {
              const rootchain = this.rootchains[i];
              const coinage = this.coinagesByRootChain[rootchain.address];

              const precomitted = toBN(
                (
                  this.seigs.slice(i + 1).length > 0
                    ? this.seigs.slice(i + 1).reduce((a, b) => a.plus(b)).div(NUM_ROOTCHAINS)
                    : _WTON('0')
                ).toFixed(WTON_UNIT),
              );
              const amount = await this.seigManager.stakeOf(rootchain.address, tokenOwner);
              const additionalTotBurnAmount = await this.seigManager.additionalTotBurnAmount(rootchain.address, tokenOwner, amount);

              console.log(`
              amount                     ${amount.toString(10).padStart(30)}
              precomitted                ${precomitted.toString(10).padStart(30)}
              additionalTotBurnAmount    ${additionalTotBurnAmount.toString(10).padStart(30)}
              `);

              const prevWTONBalance = await this.wton.balanceOf(tokenOwner);
              const prevCoinageTotalSupply = await coinage.totalSupply();
              const prevCoinageBalance = await coinage.balanceOf(tokenOwner);
              const prevTotTotalSupply = await this.tot.totalSupply();
              const prevTotBalance = await this.tot.balanceOf(rootchain.address);

              // 1. make a withdrawal request
              expect(await this.depositManager.pendingUnstaked(rootchain.address, tokenOwner)).to.be.bignumber.equal('0');
              expect(await this.depositManager.accUnstaked(rootchain.address, tokenOwner)).to.be.bignumber.equal('0');

              const tx = await this.depositManager.requestWithdrawal(rootchain.address, amount, { from: tokenOwner });

              expectEvent.inLogs(
                tx.logs,
                'WithdrawalRequested',
                {
                  rootchain: rootchain.address,
                  depositor: tokenOwner,
                  amount: amount,
                },
              );

              const { args: { coinageBurnAmount, totBurnAmount } } = await expectEvent.inTransaction(tx.tx, this.seigManager, 'UnstakeLog');

              console.log('coinageBurnAmount  ', coinageBurnAmount.toString(10).padStart(35));
              console.log('totBurnAmount      ', totBurnAmount.toString(10).padStart(35));
              console.log('diff               ', toBN(totBurnAmount).sub(toBN(coinageBurnAmount)).toString(10).padStart(35));

              expect(await this.depositManager.pendingUnstaked(rootchain.address, tokenOwner)).to.be.bignumber.equal(amount);
              expect(await this.depositManager.accUnstaked(rootchain.address, tokenOwner)).to.be.bignumber.equal('0');

              // 2. process the request
              await expectRevert(this.depositManager.processRequest(rootchain.address, { from: tokenOwner }), 'DepositManager: wait for withdrawal delay');

              await Promise.all(range(WITHDRAWAL_DELAY + 1).map(_ => time.advanceBlock()));

              expectEvent(
                await this.depositManager.processRequest(rootchain.address, { from: tokenOwner }),
                'WithdrawalProcessed',
                {
                  rootchain: rootchain.address,
                  depositor: tokenOwner,
                  amount: amount,
                },
              );

              expect(await this.depositManager.pendingUnstaked(rootchain.address, tokenOwner)).to.be.bignumber.equal('0');
              expect(await this.depositManager.accUnstaked(rootchain.address, tokenOwner)).to.be.bignumber.equal(amount);

              const curWTONBalance = await this.wton.balanceOf(tokenOwner);
              const curCoinageTotalSupply = await coinage.totalSupply();
              const curCoinageBalance = await coinage.balanceOf(tokenOwner);
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
    });
  });
});
