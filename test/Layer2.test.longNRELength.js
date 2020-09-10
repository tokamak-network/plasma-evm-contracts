const { range, last, first } = require('lodash');
const { BN, ether, time,
  expectEvent, expectRevert,
} = require('openzeppelin-test-helpers');
const chai = require('chai');
chai.use(require('chai-bn')(BN));

const { padLeft } = require('./helpers/pad');
const { marshalString, unmarshalString } = require('./helpers/marshal');

const { expect } = chai;

const EpochHandler = artifacts.require('EpochHandler.sol');
const SubmitHandler = artifacts.require('SubmitHandler.sol');
const Layer2 = artifacts.require('Layer2.sol');
const ERC20Mintable = artifacts.require('ERC20Mintable.sol');
const EtherToken = artifacts.require('EtherToken.sol');
const RequestableSimpleToken = artifacts.require('RequestableSimpleToken.sol');

const LOGTX = process.env.LOGTX || false;
const VERBOSE = process.env.VERBOSE || false;

const dummyStatesRoot = '0xdb431b544b2f5468e3f771d7843d9c5df3b4edcf8bc1c599f18f0b4ea8709bc3';
const dummyTransactionsRoot = '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421';
const dummyReceiptsRoot = '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421';

const etherAmount = ether('10');
const tokenAmount = ether('10');

/* eslint-disable no-extend-native */
String.prototype.sub = function (n) { return (web3.utils.toBN(this.toString())).sub(web3.utils.toBN(n)); };
String.prototype.add = function (n) { return (web3.utils.toBN(this.toString())).add(web3.utils.toBN(n)); };
String.prototype.cmp = function (n) { return (web3.utils.toBN(this.toString())).cmp(web3.utils.toBN(n)); };
/* eslint-enable no-extend-native */

contract('Layer2', async ([
  operator,
  ...others
]) => {
  let layer2;
  let token, mintableToken, etherToken;

  const tokenInChildChain = '0x000000000000000000000000000000000000dead';

  // layer2 parameters
  const NRELength = 1024;
  let MAX_REQUESTS;
  let COST_ERO, COST_ERU, COST_URB_PREPARE, COST_URB, COST_ORB, COST_NRB;
  let CP_COMPUTATION, CP_WITHHOLDING, CP_EXIT;

  // test env
  const currentFork = 0;
  let lastEpoch = 0;
  let lastBlock = 0;

  before(async () => {
    const developmentEtherToken = true;
    const developmentLayer2 = false;
    const swapEnabled = true;

    mintableToken = await ERC20Mintable.new();
    etherToken = await EtherToken.new(developmentEtherToken, mintableToken.address, swapEnabled);

    const epochHandler = await EpochHandler.new();
    const submitHandler = await SubmitHandler.new(epochHandler.address);

    layer2 = await Layer2.new(
      epochHandler.address,
      submitHandler.address,
      etherToken.address,
      developmentLayer2,
      web3.utils.toBN(NRELength),
      dummyStatesRoot,
      dummyTransactionsRoot,
      dummyReceiptsRoot,
    );

    COST_ERO = await layer2.COST_ERO();
    COST_ERU = await layer2.COST_ERU();
    COST_URB_PREPARE = await layer2.COST_URB_PREPARE();
    COST_URB = await layer2.COST_URB();
    COST_ORB = await layer2.COST_ORB();
    COST_NRB = await layer2.COST_NRB();
    CP_COMPUTATION = (await layer2.CP_COMPUTATION()).toNumber();
    CP_WITHHOLDING = (await layer2.CP_WITHHOLDING()).toNumber();
    CP_EXIT = (await layer2.CP_EXIT()).toNumber();

    layer2.allEvents().on('data', function (e) {
      console.log('Event?', e);
      // const eventName = e.event;
      // log(`[${eventName}]: ${JSON.stringify(e.args)}`, e);
    });
  });

  function joinEpochRoots (roots) {
    return web3.utils.soliditySha3(marshalString(
      roots.map(unmarshalString).reduce((a, b) => a + b, '')
    ));
  }

  function makePos (v1, v2) { return web3.utils.toBN(v1).shln(128).add(web3.utils.toBN(v2)); }

  const submitNRE = async () => {
    const pos1 = makePos(currentFork, lastEpoch + 1);
    const pos2 = makePos(lastBlock + 1, lastBlock + NRELength);

    const stateRoots = range(NRELength).map(() => dummyStatesRoot);
    const transactionsRoot = range(NRELength).map(() => dummyTransactionsRoot);
    const receiptsRoots = range(NRELength).map(() => dummyReceiptsRoot);

    const epochStateRoot = joinEpochRoots(stateRoots);
    const epochTransactionsRoot = joinEpochRoots(transactionsRoot);
    const epochReceiptsRoots = joinEpochRoots(receiptsRoots);

    await time.increase(CP_WITHHOLDING + 2);

    const tx = await layer2.submitNRE(
      pos1,
      pos2,
      epochStateRoot,
      epochTransactionsRoot,
      epochReceiptsRoots,
      { value: COST_NRB }
    );
    logtx(tx);

    lastEpoch += 2;
    lastBlock += NRELength;
  };

  const numNRE = 10;
  for (const i of range(numNRE)) {
    it(`should submit NRE#${i * 2 + 1}`, submitNRE);
  }

  it('Block should be finalized while submitting', async () => {
    await submitNRE();

    expect(await layer2.getLastFinalizedBlock(currentFork)).to.be.bignumber.equal(new BN(NRELength * numNRE));
    expect(await layer2.getLastFinalizedEpoch(currentFork)).to.be.bignumber.equal(new BN(numNRE * 2 - 1));
  });
});

function log (...args) {
  if (VERBOSE) console.log(...args);
}

function logtx (tx) {
  delete (tx.receipt.logsBloom);
  delete (tx.receipt.v);
  delete (tx.receipt.r);
  delete (tx.receipt.s);
  delete (tx.receipt.logs);
  tx.logs = tx.logs.map(({ event, args }) => ({ event, args }));
  if (LOGTX) console.log(JSON.stringify(tx, null, 2));
}
