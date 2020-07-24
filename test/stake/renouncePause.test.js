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

/**
 *
 * @param {Contract} seigManager
 * @param {String} rootchainAddr
 * @param {String} userAddr
 * @returns {Object.operatorSeigs}
 * @returns {Object.userSeigs}
 */
async function expectedSeigs (seigManager, rootchainAddr, userAddr) {
  // contracts
  const rootchain = await RootChain.at(rootchainAddr);
  const ton = await TON.at(await seigManager.ton());
  const wton = await TON.at(await seigManager.wton());
  const tot = await CustomIncrementCoinage.at(await seigManager.tot());
  const coinageAddr = await seigManager.coinages(rootchainAddr);
  const coinage = await CustomIncrementCoinage.at(coinageAddr);

  // storages
  const operator = await rootchain.operator();
  const seigPerBlock = _WTON(await seigManager.seigPerBlock(), WTON_UNIT);
  const prevTotTotalSupply = _WTON(await tot.totalSupply(), WTON_UNIT);
  const prevTotBalance = _WTON(await tot.balanceOf(rootchainAddr), WTON_UNIT);
  const prevCoinageTotalSupply = _WTON(await coinage.totalSupply(), WTON_UNIT);
  const prevCoinageOperatorBalance = _WTON(await coinage.balanceOf(operator), WTON_UNIT);
  const prevCoinageUsersBalance = prevCoinageTotalSupply.minus(prevCoinageOperatorBalance);
  const prevCoinageUserBalance = _WTON(await coinage.balanceOf(userAddr), WTON_UNIT);
  const commissioniRate = _WTON(await seigManager.commissionRates(rootchainAddr), WTON_UNIT);
  const isCommissionRateNegative = await seigManager.isCommissionRateNegative(rootchainAddr);

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
    return stakedSeigs;
  }

  const stakedSeigs = await increaseTot();
  const rootchainSeigs = stakedSeigs.times(prevTotBalance).div(prevTotTotalSupply);

  const operatorSeigs = rootchainSeigs.times(prevCoinageOperatorBalance).div(prevCoinageTotalSupply);
  const usersSeigs = rootchainSeigs.times(prevCoinageUsersBalance).div(prevCoinageTotalSupply);

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
    rootchainSeigs: rootchainSeigs,
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

      // multiple root chains test
      for (const _i in range(NUM_ROOTCHAINS)) {
        const i = Number(_i);
        const indices = range(0, i + 1);
        const c = indices.map(i => `${i}-th`).join(', ');
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

        describe('after seig manager`s auth is removed', function () {
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
            await this.seigManager.addPauser(tokenOwner1);
            await makeWithdrawalRequest.call(this, NUM_WITHDRAWN_ROOTCHAINS);
            await this.seigManager.pause({ from: tokenOwner1 });
          });

          it('seigniorage must not be given', async function () {
            const totTotalSupply1 = await this.tot.totalSupply();
            await this._commit(this.rootchains[i]);
            const totTotalSupply2 = await this.tot.totalSupply();

            expect(totTotalSupply2).to.be.bignumber.equal(totTotalSupply1);
          });

          behaveWhenPausedOrNot();

          describe('after renounce pauser and try to unpause seig manager', function () {
            beforeEach(async function () {
              await makeWithdrawalRequest.call(this, NUM_WITHDRAWN_ROOTCHAINS);
              await this.seigManager.renouncePauser(tokenOwner1);
            });

            it('seigniorage must not be given', async function () {
              const totTotalSupply1 = await this.tot.totalSupply();
              await this._commit(this.rootchains[i]);
              const totTotalSupply2 = await this.tot.totalSupply();

              expect(totTotalSupply2).to.be.bignumber.equal(totTotalSupply1);
            });

            behaveWhenPausedOrNot();
          });

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
    });
  });
});
