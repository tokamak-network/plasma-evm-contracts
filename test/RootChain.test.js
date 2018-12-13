const { range } = require('lodash');
const expectEvent = require('openzeppelin-solidity/test/helpers/expectEvent');

const { padLeft } = require('./helpers/pad');
const { appendHex } = require('./helpers/appendHex');
const Data = require('./lib/Data');

const RootChain = artifacts.require('RootChain.sol');
const RequestableSimpleToken = artifacts.require('RequestableSimpleToken.sol');

require('chai')
  .use(require('chai-bignumber')(web3.BigNumber))
  .should();

const BigNumber = web3.BigNumber;
const verbose = process.env.VERBOSE || false;

const etherAmount = new BigNumber(10e18);
const tokenAmount = new BigNumber(10e18);
const exitAmount = tokenAmount.div(1000);
const emptyBytes32 = 0;

// genesis block merkle roots
const statesRoot = '0x0ded2f89db1e11454ba4ba90e31850587943ed4a412f2ddf422bd948eae8b164';
const transactionsRoot = '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421';
const receiptsRoot = '0x000000000000000000000000000000000000000000000000000000000000dead';

// eslint-disable-next-line max-len
const failedReceipt = '0xf9010800825208b9010000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c0';
const dummyProof = '0x00';

contract('RootChain', async ([
  operator,
  ...others
]) => {
  let rootchain;
  let token;
  const tokenInChildChain = '0x000000000000000000000000000000000000dead';

  // account parameters
  others = others.slice(0, 4);

  // rootchain parameters
  let MAX_REQUESTS;
  let NRBEpochLength; // === 2
  let COST_ERO, COST_ERU, COST_URB_PREPARE, COST_URB, COST_ORB, COST_NRB;
  let CP_COMPUTATION, CP_WITHHOLDING;

  const currentFork = 0;
  let lastEpoch = 1;
  let currentBlockNumber = 0;
  let numRequests = 0;
  let requestIdToApply = 0;

  // rootchain.State
  const State = {
    AcceptingNRB: 0,
    AcceptingORB: 1,
    AcceptingURB: 2,
  };

  before(async () => {
    rootchain = await RootChain.deployed();
    token = await RequestableSimpleToken.new();

    await Promise.all(others.map(other => token.mint(other, tokenAmount.mul(100))));
    await rootchain.mapRequestableContractByOperator(token.address, tokenInChildChain);
    (await rootchain.requestableContracts(token.address)).should.be.equal(tokenInChildChain);

    // read parameters
    MAX_REQUESTS = await rootchain.MAX_REQUESTS();
    NRBEpochLength = await rootchain.NRBEpochLength();
    COST_ERO = await rootchain.COST_ERO();
    COST_ERU = await rootchain.COST_ERU();
    COST_URB_PREPARE = await rootchain.COST_URB_PREPARE();
    COST_URB = await rootchain.COST_URB();
    COST_ORB = await rootchain.COST_ORB();
    COST_NRB = await rootchain.COST_NRB();
    CP_COMPUTATION = (await rootchain.CP_COMPUTATION()).toNumber();
    CP_WITHHOLDING = (await rootchain.CP_WITHHOLDING()).toNumber();

    log(`
      RootChain contract at ${rootchain.address}
      `);

    const targetEvents = ['BlockFinalized', 'EpochFinalized', 'RequestFinalized', 'RequestChallenged'];

    for (const eventName of targetEvents) {
      const event = rootchain[eventName]({});
      event.watch((err, ev) => {
        if (!err) {
          log(`
            [${eventName}]: ${JSON.stringify(ev.args)}
            `);
        } else {
          console.error(`[${eventName}]`, err);
        }
      });
    }
  });

  async function getFinalized (forkNunber, blockNumber) {
    const pb = new Data.PlasmaBlock(await rootchain.getBlock(currentFork, blockNumber));
    return pb.finalized;
  }

  async function checkEpochNumber () {
    (await rootchain.lastEpoch(currentFork))
      .should.be.bignumber.equal(lastEpoch);
  }

  async function checkEpoch (epochNumber) {
    const epoch1 = new Data.Epoch(await rootchain.getEpoch(currentFork, epochNumber));

    // check # of blocks
    if (epoch1.isRequest) {
      const numBlocks1 = epoch1.requestEnd.sub(epoch1.requestStart).add(1).div(MAX_REQUESTS).ceil();
      const numBlocks2 = epoch1.endBlockNumber.sub(epoch1.startBlockNumber).add(1);
      numBlocks2.should.be.bignumber.equal(numBlocks1);
    }

    if (epochNumber === 1) { // first NRB epoch
      epoch1.startBlockNumber.should.be.bignumber.equal(1);
      epoch1.endBlockNumber.should.be.bignumber.equal(NRBEpochLength);
      epoch1.isRequest.should.be.equal(false);
      epoch1.isEmpty.should.be.equal(false);
    } else if (epochNumber === 2) { // second ORB epoch
      if (epoch1.isEmpty) {
        epoch1.startBlockNumber.should.be.bignumber.equal(NRBEpochLength);
        epoch1.endBlockNumber.should.be.bignumber.equal(epoch1.startBlockNumber);
      } else {
        epoch1.startBlockNumber.should.be.bignumber.equal(NRBEpochLength.add(1));
      }
      epoch1.isRequest.should.be.equal(true);
    } else if (epochNumber > 2 && epoch1.isRequest) { // later request epochs
      // previous non request epoch
      const epoch2 = new Data.Epoch(await rootchain.getEpoch(currentFork, epochNumber - 1));

      if (epoch1.isEmpty) {
        epoch1.startBlockNumber.should.be.bignumber.equal(epoch2.endBlockNumber);
        epoch1.endBlockNumber.should.be.bignumber.equal(epoch1.startBlockNumber);

        // previous request epoch
        const epoch3 = new Data.Epoch(await rootchain.getEpoch(currentFork, epochNumber - 2));

        epoch1.requestStart.should.be.bignumber.equal(epoch3.requestEnd);
        epoch1.requestStart.should.be.bignumber.equal(epoch1.requestEnd);
      } else {
        epoch1.startBlockNumber.should.be.bignumber.equal(epoch2.endBlockNumber.add(1));
        epoch1.requestEnd.should.be.bignumber.gt(epoch1.requestStart);
      }
    } else if (epochNumber > 2 && !epoch1.isRequest) { // later non request epochs
      // previous request epoch
      const epoch2 = new Data.Epoch(await rootchain.getEpoch(currentFork, epochNumber - 1));

      epoch1.startBlockNumber.should.be.bignumber.equal(epoch2.endBlockNumber.add(1));
      epoch1.endBlockNumber.sub(epoch1.startBlockNumber).add(1).should.be.bignumber.equal(NRBEpochLength);
      epoch1.isRequest.should.be.equal(false);
      epoch1.isEmpty.should.be.equal(false);
    }
  }

  async function checkBlockNumber () {
    (await rootchain.lastBlock(currentFork))
      .should.be.bignumber.equal(currentBlockNumber);
  }

  async function checkState (state) {
    (await rootchain.state()).should.be.bignumber.equal(state);
  }

  async function submitDummyNRB () {
    await checkBlockNumber();

    await rootchain.submitNRB(statesRoot, transactionsRoot, receiptsRoot, { value: COST_NRB });
    currentBlockNumber += 1;

    await checkBlockNumber();
  }

  async function submitDummyORB () {
    await checkBlockNumber();

    await rootchain.submitORB(statesRoot, transactionsRoot, receiptsRoot, { value: COST_ORB });
    currentBlockNumber += 1;

    await checkBlockNumber();
  }

  async function finalizeBlocks () {
    // finalize blocks until all blocks are fianlized
    const lastFinalizedBlock = await rootchain.getLastFinalizedBlock(currentFork);
    if (lastFinalizedBlock.gte(new BigNumber(currentBlockNumber))) {
      return;
    }
    log(`
      lastBlock: ${await rootchain.lastBlock(currentFork)}
      lastFinalizedBlock: ${await rootchain.getLastFinalizedBlock(currentFork)}
      `);

    await timeout(CP_WITHHOLDING + 1);
    await rootchain.finalizeBlock();
    return finalizeBlocks();
  }

  async function applyRequests (invalid = false) {
    await finalizeBlocks();

    for (const requestId of range(requestIdToApply, numRequests)) {
      const request1 = new Data.Request(await rootchain.EROs(requestId));

      request1.finalized.should.be.equal(false);

      const etherAmount1 = await web3.eth.getBalance(request1.to);
      const tokenBalance1 = await token.balances(request1.requestor);

      const tx = await rootchain.applyRequest();
      const e = await expectEvent.inTransaction(tx, 'RequestFinalized');

      const request2 = new Data.Request(await rootchain.EROs(requestId));

      request2.finalized.should.be.equal(true);

      const etherAmount2 = await web3.eth.getBalance(request1.to);
      const tokenBalance2 = await token.balances(request2.requestor);

      if (request1.isExit && !invalid) {
        tokenBalance2.should.be.bignumber
          .equal(tokenBalance1.add(parseInt(request1.trieValue, 16)));
      } else if (invalid) {
        request2.challenged.should.be.equal(true);
        tokenBalance2.should.be.bignumber.equal(tokenBalance1);
      }
      requestIdToApply = e.args.requestId.toNumber() + 1;
    }
  }

  async function logEpochAndBlock (epochNumber) {
    log(`
      Epoch#${lastEpoch} ${await rootchain.getEpoch(currentFork, epochNumber)}
      ORBs.length: ${await rootchain.getNumORBs()}
      `);
    const epoch = new Data.Epoch(await rootchain.getEpoch(currentFork, epochNumber));

    for (const i of range(
      epoch.startBlockNumber.toNumber(),
      epoch.endBlockNumber.toNumber() + 1
    )) {
      log(`
        block#${i} ${await rootchain.getBlock(currentFork, i)}`);
    }
  }

  const testEpochsWithoutRequest = (NRBEPochNumber) => {
    const ORBEPochNumber = NRBEPochNumber + 1;

    before(`check NRB Epoch#${NRBEPochNumber} parameters`, async () => {
      await checkState(State.AcceptingNRB);
      await checkBlockNumber();
      await checkEpochNumber();

      await checkEpoch(lastEpoch);
    });

    it(`next empty ORB Epoch#${ORBEPochNumber} should be prepared`, async () => {
      // submits `NRBEpochLength` NRBs
      await Promise.all(range(NRBEpochLength).map(submitDummyNRB));
      await logEpochAndBlock(lastEpoch - 1);
      await logEpochAndBlock(lastEpoch);

      // because no ERO, ORB epoch is empty
      lastEpoch += 2;
      await checkEpochNumber();
      await checkEpoch(lastEpoch - 1);
      await checkEpoch(lastEpoch);
      await checkState(State.AcceptingNRB);
    });

    it('can finalize blocks', finalizeBlocks);
  };

  const testEpochsWithRequest = (NRBEPochNumber) => {
    const ORBEPochNumber = NRBEPochNumber + 1;

    before(`check NRB Epoch#${NRBEPochNumber} parameters`, async () => {
      await checkState(State.AcceptingNRB);

      await checkBlockNumber();

      await checkEpochNumber();
      await checkEpoch(lastEpoch);
    });

    it(`NRBEpoch#${NRBEPochNumber}: user can make an enter request for ether deposit`, async () => {
      const isTransfer = true;

      (await rootchain.getNumEROs()).should.be.bignumber.equal(numRequests);
      const numORBs = await rootchain.getNumORBs();

      const txs = await Promise.all(others.map(async other => {
        const tx = await rootchain.startEnter(isTransfer, other, emptyBytes32, emptyBytes32, {
          from: other,
          value: etherAmount,
        });

        const requestId = tx.logs[0].args.requestId;
        const requestTxRLPBytes = await rootchain.getEROBytes(requestId);

        // TODO: check the RLP encoded bytes
        requestTxRLPBytes.slice(2, 4).toLowerCase().should.be.equal('ec');

        return tx;
      }));

      (await rootchain.getNumORBs()).should.be.bignumber.equal(numORBs.add(1));

      numRequests += others.length;

      (await rootchain.getNumEROs()).should.be.bignumber.equal(numRequests);
    });

    it(`NRBEpoch#${NRBEPochNumber}: user can make an enter request for token deposit`, async () => {
      const isTransfer = false;

      (await rootchain.getNumEROs()).should.be.bignumber.equal(numRequests);
      const numORBs = await rootchain.getNumORBs();

      for (const other of others) {
        const trieKey = calcTrieKey(other);
        const trieValue = padLeft(web3.fromDecimal(tokenAmount));

        (await token.getBalanceTrieKey(other)).should.be.equals(trieKey);

        const tokenBalance1 = await token.balances(other);
        await rootchain.startEnter(isTransfer, token.address, trieKey, trieValue, { from: other });

        (await token.balances(other)).should.be.bignumber.equal(tokenBalance1.sub(tokenAmount));
      }

      numRequests += others.length;

      (await rootchain.getNumEROs()).should.be.bignumber.equal(numRequests);
    });

    it(`NRBEpoch#${NRBEPochNumber}: operator submits NRBs`, async () => {
      await Promise.all(range(NRBEpochLength).map(submitDummyNRB));
      await logEpochAndBlock(lastEpoch);

      lastEpoch += 1;
      await checkEpochNumber();
      await checkEpoch(lastEpoch - 1);
      await checkEpoch(lastEpoch);
      await checkState(State.AcceptingORB);
    });

    it(`ORBEpoch#${ORBEPochNumber}: operator submits ORBs`, async () => {
      const epoch = new Data.Epoch(await rootchain.getEpoch(currentFork, ORBEPochNumber));
      await logEpochAndBlock(lastEpoch);

      const numORBs = epoch.endBlockNumber.sub(epoch.startBlockNumber).add(1);
      await Promise.all(range(numORBs).map(submitDummyORB));

      lastEpoch += 1;
      await checkEpochNumber();
      await checkEpoch(lastEpoch - 1);
      await checkEpoch(lastEpoch);
      await checkState(State.AcceptingNRB);
    });

    it('can finalize blocks', finalizeBlocks);

    it('should finalize requests', applyRequests);
  };

  const testEpochsWithExitRequest = (NRBEPochNumber) => {
    const ORBEPochNumber = NRBEPochNumber + 1;

    before(async () => {
      log(`
        Epoch#${lastEpoch - 1} ${await rootchain.getEpoch(currentFork, lastEpoch - 1)}
        Epoch#${lastEpoch} ${await rootchain.getEpoch(currentFork, lastEpoch)}
        `);
    });

    it(`NRBEpoch#${NRBEPochNumber}: user can make an exit request for token withdrawal`, async () => {
      const isTransfer = false;

      (await rootchain.getNumEROs()).should.be.bignumber.equal(numRequests);

      await Promise.all(others.map(other => {
        const trieKey = calcTrieKey(other);
        const trieValue = padLeft(web3.toHex(exitAmount));

        return rootchain.startExit(token.address, 0, trieKey, trieValue, { from: other, value: COST_ERU });
      }));

      numRequests += others.length;

      (await rootchain.getNumEROs()).should.be.bignumber.equal(numRequests);
    });

    it(`NRBEpoch#${NRBEPochNumber}: operator submits NRBs`, async () => {
      await Promise.all(range(NRBEpochLength).map(submitDummyNRB));
      lastEpoch += 1;
      await checkEpochNumber();
      await checkEpoch(lastEpoch - 1);
      await checkEpoch(lastEpoch);
      await checkState(State.AcceptingORB);
    });

    it(`ORBEpoch#${ORBEPochNumber}: operator submits ORBs`, async () => {
      const epoch = new Data.Epoch(await rootchain.getEpoch(currentFork, ORBEPochNumber));

      const numORBs = epoch.endBlockNumber.sub(epoch.startBlockNumber).add(1);
      await Promise.all(range(numORBs).map(submitDummyORB));

      lastEpoch += 1;
      await checkEpochNumber();
      await checkEpoch(lastEpoch - 1);
      await checkEpoch(lastEpoch);
      await checkState(State.AcceptingNRB);
    });

    it('can finalize blocks', finalizeBlocks);

    it('should finalize requests', applyRequests);
  };

  const testEpochsWithInvalidExitRequest = (NRBEPochNumber) => {
    const ORBEPochNumber = NRBEPochNumber + 1;
    const invalidExit = true;

    before(async () => {
      log(`
        Epoch#${lastEpoch - 1} ${await rootchain.getEpoch(currentFork, lastEpoch - 1)}
        Epoch#${lastEpoch} ${await rootchain.getEpoch(currentFork, lastEpoch)}
        `);
    });

    it(`NRBEpoch#${NRBEPochNumber}: user can make an invalid exit request for token withdrawal`, async () => {
      const isTransfer = false;

      (await rootchain.getNumEROs()).should.be.bignumber.equal(numRequests);

      await Promise.all(others.map(other => {
        const trieKey = calcTrieKey(other);
        const trieValue = padLeft(web3.toHex(tokenAmount.mul(10)));

        return rootchain.startExit(token.address, 0, trieKey, trieValue, { from: other, value: COST_ERU });
      }));

      numRequests += others.length;

      (await rootchain.getNumEROs()).should.be.bignumber.equal(numRequests);
    });

    it(`NRBEpoch#${NRBEPochNumber}: operator submits NRBs`, async () => {
      await Promise.all(range(NRBEpochLength).map(submitDummyNRB));
      lastEpoch += 1;
      await checkEpochNumber();
      await checkEpoch(lastEpoch - 1);
      await checkEpoch(lastEpoch);
      await checkState(State.AcceptingORB);
    });

    it(`ORBEpoch#${ORBEPochNumber}: operator submits ORBs`, async () => {
      const epoch = new Data.Epoch(await rootchain.getEpoch(currentFork, ORBEPochNumber));

      const numORBs = epoch.endBlockNumber.sub(epoch.startBlockNumber).add(1);
      await Promise.all(range(numORBs).map(submitDummyORB));

      lastEpoch += 1;
      await checkEpochNumber();
      await checkEpoch(lastEpoch - 1);
      await checkEpoch(lastEpoch);
      await checkState(State.AcceptingNRB);
    });

    it('can finalize blocks', finalizeBlocks);

    it('can challenge on invalid exit', async () => {
      await logEpochAndBlock(ORBEPochNumber);
      const epoch = new Data.Epoch(await rootchain.getEpoch(currentFork, ORBEPochNumber));

      epoch.isRequest.should.be.equal(true);

      const numORBs = epoch.endBlockNumber.sub(epoch.startBlockNumber).add(1);

      for (const blockNumber of range(epoch.startBlockNumber, epoch.endBlockNumber.add(1))) {
        const finalized = await getFinalized(currentFork, blockNumber);

        const block = new Data.PlasmaBlock(await rootchain.getBlock(currentFork, blockNumber));

        block.finalized.should.be.equal(true, `Block${blockNumber} is not finalized`);

        const requestBlock = new Data.RequestBlock(await rootchain.EROs(block.requestBlockId));

        const numRequestsInBlock = epoch.requestEnd - epoch.requestStart + 1;

        for (const i of range(numRequestsInBlock)) {
          const tx = await rootchain.challengeExit(
            currentFork,
            blockNumber,
            i,
            failedReceipt,
            dummyProof
          );
        }
      }
    });

    it('should finalize invalid requests', async () => { applyRequests(invalidExit); });
  };

  const tests = [
    testEpochsWithoutRequest,
    testEpochsWithoutRequest,
    testEpochsWithoutRequest,
    testEpochsWithRequest,
    testEpochsWithRequest,
    testEpochsWithRequest,
    testEpochsWithExitRequest,
    testEpochsWithRequest,
    testEpochsWithExitRequest,
    testEpochsWithRequest,
    testEpochsWithInvalidExitRequest,
    testEpochsWithInvalidExitRequest,
    testEpochsWithExitRequest,
    testEpochsWithRequest,
    testEpochsWithExitRequest,
    testEpochsWithInvalidExitRequest,
  ];

  // generate mocha test cases
  for (const i of range(0, tests.length)) {
    const epochNumber = 1 + i * 2;
    const t = tests[i];

    describe(`${i + 1}: Epoch#${epochNumber} (${t.name})`, () => {
      t(epochNumber);
    });
  }
});

function timeout (sec) {
  return new Promise((resolve) => {
    setTimeout(resolve, sec * 1000);
  });
}

function calcTrieKey (addr) {
  return web3.sha3(appendHex(padLeft(addr), padLeft('0x02')), { encoding: 'hex' });
}

function log (...args) {
  if (verbose) console.log(...args);
}
