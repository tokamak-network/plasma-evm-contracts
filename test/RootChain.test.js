const { range } = require('lodash');
const expectEvent = require('openzeppelin-solidity/test/helpers/expectEvent');

const { padLeft } = require('./helpers/pad');
const { appendHex } = require('./helpers/appendHex');

const RootChain = artifacts.require('RootChain.sol');
const RequestableSimpleToken = artifacts.require('RequestableSimpleToken.sol');

require('chai')
  .use(require('chai-bignumber')(web3.BigNumber))
  .should();

const BigNumber = web3.BigNumber;
const verbose = false;

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
  let currentEpoch = 1;
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
    return (await rootchain.blocks(currentFork, blockNumber))[11];
  }

  async function checkEpochNumber () {
    (await rootchain.currentEpoch())
      .should.be.bignumber.equal(currentEpoch);
  }

  async function checkEpoch (epochNumber) {
    const [
      requestStart1, requestEnd1, startBlockNumber1, endBlockNumber1, forkedBlockNumber1, firstRequestBlockId1,
      limit1, timestamp1, isEmpty1, initialized1, isRequest1, userActivated1, finalized1,
    ] = await rootchain.epochs(currentFork, epochNumber);

    // check # of blocks
    if (isRequest1) {
      const numBlocks1 = requestEnd1.sub(requestStart1).add(1).div(MAX_REQUESTS).ceil();
      const numBlocks2 = endBlockNumber1.sub(startBlockNumber1).add(1);
      numBlocks2.should.be.bignumber.equal(numBlocks1);
    }

    if (epochNumber === 1) { // first NRB epoch
      startBlockNumber1.should.be.bignumber.equal(1);
      endBlockNumber1.should.be.bignumber.equal(NRBEpochLength);
      isRequest1.should.be.equal(false);
      isEmpty1.should.be.equal(false);
    } else if (epochNumber === 2) { // second ORB epoch
      if (isEmpty1) {
        startBlockNumber1.should.be.bignumber.equal(NRBEpochLength);
        endBlockNumber1.should.be.bignumber.equal(startBlockNumber1);
      } else {
        startBlockNumber1.should.be.bignumber.equal(NRBEpochLength.add(1));
      }
      isRequest1.should.be.equal(true);
    } else if (epochNumber > 2 && isRequest1) { // later request epochs
      // previous non request epoch
      const [
        requestStart2, requestEnd2, startBlockNumber2, endBlockNumber2, forkedBlockNumber2, firstRequestBlockId2,
        limit2, timestamp2, isEmpty2, initialized2, isRequest2, userActivated2, finalized2,
      ] = await rootchain.epochs(currentFork, epochNumber - 1);

      if (isEmpty1) {
        startBlockNumber1.should.be.bignumber.equal(endBlockNumber2);
        endBlockNumber1.should.be.bignumber.equal(startBlockNumber1);

        // previous request epoch
        const [
          requestStart3, requestEnd3, startBlockNumber3, endBlockNumber3, forkedBlockNumber3, firstRequestBlockId3,
          limit3, timestamp3, isEmpty3, initialized3, isRequest3, userActivated3, finalized3,
        ] = await rootchain.epochs(currentFork, epochNumber - 2);

        requestStart1.should.be.bignumber.equal(requestEnd3);
        requestStart1.should.be.bignumber.equal(requestEnd1);
      } else {
        startBlockNumber1.should.be.bignumber.equal(endBlockNumber2.add(1));
        requestEnd1.should.be.bignumber.gt(requestStart1);
      }
    } else if (epochNumber > 2 && !isRequest1) { // later non request epochs
      // previous request epoch
      const [
        requestStart2, requestEnd2, startBlockNumber2, endBlockNumber2, forkedBlockNumber2, firstRequestBlockId2,
        limit2, timestamp2, isEmpty2, initialized2, isRequest2, userActivated2, finalized2,
      ] = await rootchain.epochs(currentFork, epochNumber - 1);

      startBlockNumber1.should.be.bignumber.equal(endBlockNumber2.add(1));
      endBlockNumber1.sub(startBlockNumber1).add(1).should.be.bignumber.equal(NRBEpochLength);
      isRequest1.should.be.equal(false);
      isEmpty1.should.be.equal(false);
    }
  }

  async function checkBlockNumber () {
    (await rootchain.highestBlockNumber(currentFork))
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
    const lastFinalizedBlock = await rootchain.lastFinalizedBlock(currentFork);
    if (lastFinalizedBlock.gte(new BigNumber(currentBlockNumber))) {
      return;
    }
    log(`
      highestBlockNumber: ${await rootchain.highestBlockNumber(currentFork)}
      lastFinalizedBlock: ${await rootchain.lastFinalizedBlock(currentFork)}
      `);

    await timeout(CP_WITHHOLDING + 1);
    await rootchain.finalizeBlock();
    return finalizeBlocks();
  }

  async function applyRequests (invalid = false) {
    await finalizeBlocks();

    for (const requestId of range(requestIdToApply, numRequests)) {
      const [
        timestamp1, isExit1, isTransfer1, finalized1, challenged1,
        value1, requestor1, to1, trieKey1, trieValue1,
      ] = await rootchain.EROs(requestId);

      finalized1.should.be.equal(false);

      const etherAmount1 = await web3.eth.getBalance(to1);
      const tokenBalance1 = await token.balances(requestor1);

      const tx = await rootchain.applyRequest();
      const e = await expectEvent.inTransaction(tx, 'RequestFinalized');

      const [
        timestamp2, isExit2, isTransfer2, finalized2, challenged2,
        value2, requestor2, to2, trieKey2, trieValue2,
      ] = await rootchain.EROs(requestId);

      finalized2.should.be.equal(true);

      const etherAmount2 = await web3.eth.getBalance(to1);
      const tokenBalance2 = await token.balances(requestor1);

      if (isExit1 && !invalid) {
        tokenBalance2.should.be.bignumber
          .equal(tokenBalance1.add(parseInt(trieValue1, 16)));
      } else if (invalid) {
        const [
          timestamp3, isExit3, isTransfer3, finalized3, challenged3,
          value3, requestor3, to3, trieKey3, trieValue3, hash3,
        ] = await rootchain.EROs(requestId);
        challenged3.should.be.equal(true);
        tokenBalance2.should.be.bignumber.equal(tokenBalance1);
      }
      requestIdToApply = e.args.requestId.toNumber() + 1;
    }
  }

  async function logEpochAndBlock (epochNumber) {
    log(`
      Epoch#${currentEpoch} ${await rootchain.epochs(currentFork, epochNumber)}
      ORBs.length: ${await rootchain.getNumORBs()}
      `);
    const [
      requestStart1, requestEnd1, startBlockNumber1, endBlockNumber1, forkedBlockNumber1, firstRequestBlockId1,
      limit1, timestamp1, isEmpty1, initialized1, isRequest1, userActivated1, finalized1,
    ] = await rootchain.epochs(currentFork, epochNumber);

    for (const i of range(startBlockNumber1.toNumber(), endBlockNumber1.toNumber() + 1)) {
      log(`
        block#${i} ${await rootchain.blocks(currentFork, i)}`);
    }
  }

  const testEpochsWithoutRequest = (NRBEPochNumber) => {
    const ORBEPochNumber = NRBEPochNumber + 1;

    before(`check NRB Epoch#${NRBEPochNumber} parameters`, async () => {
      await checkState(State.AcceptingNRB);
      await checkBlockNumber();
      await checkEpochNumber();

      await checkEpoch(currentEpoch);
    });

    it(`next empty ORB Epoch#${ORBEPochNumber} should be prepared`, async () => {
      // submits `NRBEpochLength` NRBs
      await Promise.all(range(NRBEpochLength).map(submitDummyNRB));
      await logEpochAndBlock(currentEpoch - 1);
      await logEpochAndBlock(currentEpoch);

      // because no ERO, ORB epoch is empty
      currentEpoch += 2;
      await checkEpochNumber();
      await checkEpoch(currentEpoch - 1);
      await checkEpoch(currentEpoch);
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
      await checkEpoch(currentEpoch);
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
      await logEpochAndBlock(currentEpoch);

      currentEpoch += 1;
      await checkEpochNumber();
      await checkEpoch(currentEpoch - 1);
      await checkEpoch(currentEpoch);
      await checkState(State.AcceptingORB);
    });

    it(`ORBEpoch#${ORBEPochNumber}: operator submits ORBs`, async () => {
      const [
        requestStart, requestEnd, startBlockNumber, endBlockNumber, forkedBlockNumber, firstRequestBlockId,
        limit, timestamp, isEmpty, initialized, isRequest, userActivated, finalized,
      ] = await rootchain.epochs(currentFork, currentEpoch);
      await logEpochAndBlock(currentEpoch);

      const numORBs = endBlockNumber.sub(startBlockNumber).add(1);
      await Promise.all(range(numORBs).map(submitDummyORB));

      currentEpoch += 1;
      await checkEpochNumber();
      await checkEpoch(currentEpoch - 1);
      await checkEpoch(currentEpoch);
      await checkState(State.AcceptingNRB);
    });

    it('can finalize blocks', finalizeBlocks);

    it('should finalize requests', applyRequests);
  };

  const testEpochsWithExitRequest = (NRBEPochNumber) => {
    const ORBEPochNumber = NRBEPochNumber + 1;

    before(async () => {
      log(`
        Epoch#${currentEpoch - 1} ${await rootchain.epochs(currentFork, currentEpoch - 1)}
        Epoch#${currentEpoch} ${await rootchain.epochs(currentFork, currentEpoch)}
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
      currentEpoch += 1;
      await checkEpochNumber();
      await checkEpoch(currentEpoch - 1);
      await checkEpoch(currentEpoch);
      await checkState(State.AcceptingORB);
    });

    it(`ORBEpoch#${ORBEPochNumber}: operator submits ORBs`, async () => {
      const [
        requestStart, requestEnd, startBlockNumber, endBlockNumber, forkedBlockNumber, firstRequestBlockId,
        limit, timestamp, isEmpty, initialized, isRequest, userActivated, finalized,
      ] = await rootchain.epochs(currentFork, currentEpoch);

      const numORBs = endBlockNumber.sub(startBlockNumber).add(1);
      await Promise.all(range(numORBs).map(submitDummyORB));

      currentEpoch += 1;
      await checkEpochNumber();
      await checkEpoch(currentEpoch - 1);
      await checkEpoch(currentEpoch);
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
        Epoch#${currentEpoch - 1} ${await rootchain.epochs(currentFork, currentEpoch - 1)}
        Epoch#${currentEpoch} ${await rootchain.epochs(currentFork, currentEpoch)}
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
      currentEpoch += 1;
      await checkEpochNumber();
      await checkEpoch(currentEpoch - 1);
      await checkEpoch(currentEpoch);
      await checkState(State.AcceptingORB);
    });

    it(`ORBEpoch#${ORBEPochNumber}: operator submits ORBs`, async () => {
      const [
        requestStart, requestEnd, startBlockNumber, endBlockNumber, forkedBlockNumber, firstRequestBlockId,
        limit, timestamp, isEmpty, initialized, isRequest, userActivated, finalized,
      ] = await rootchain.epochs(currentFork, currentEpoch);

      const numORBs = endBlockNumber.sub(startBlockNumber).add(1);
      await Promise.all(range(numORBs).map(submitDummyORB));

      currentEpoch += 1;
      await checkEpochNumber();
      await checkEpoch(currentEpoch - 1);
      await checkEpoch(currentEpoch);
      await checkState(State.AcceptingNRB);
    });

    it('can finalize blocks', finalizeBlocks);

    it('can challenge on invalid exit', async () => {
      await logEpochAndBlock(ORBEPochNumber);
      const [
        requestStart, requestEnd, startBlockNumber, endBlockNumber, , , , , , , isRequest,
      ] =
        await rootchain.epochs(currentFork, ORBEPochNumber);

      isRequest.should.be.equal(true);

      const numORBs = endBlockNumber.sub(startBlockNumber).add(1);

      for (const blockNumber of range(startBlockNumber, endBlockNumber.add(1))) {
        const finalized = await getFinalized(currentFork, blockNumber);

        const pb = (await rootchain.blocks(currentFork, blockNumber));
        const requestBlockId = pb[2];

        finalized.should.be.equal(true, `Block${blockNumber} is not finalized`);

        const [, , requestStart2, requestEnd2] =
            await rootchain.EROs(requestBlockId);

        const numRequestsInBlock = requestEnd - requestStart + 1;

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
    describe(`${i + 1}: Epoch#${epochNumber}`, () => {
      tests[i](epochNumber);
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
