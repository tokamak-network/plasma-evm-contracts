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

const etherAmount = new BigNumber(10e18);
const tokenAmount = new BigNumber(10e18);
const emptyBytes32 = 0;

// genesis block merkle roots
const statesRoot = '0x0ded2f89db1e11454ba4ba90e31850587943ed4a412f2ddf422bd948eae8b164';
const transactionsRoot = '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421';
const intermediateStatesRoot = '0x000000000000000000000000000000000000000000000000000000000000dead';

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
  let NRBEpochLength; // == 2
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
    CP_COMPUTATION = await rootchain.CP_COMPUTATION();
    CP_WITHHOLDING = await rootchain.CP_WITHHOLDING();

    console.log(`
      RootChain contract at ${rootchain.address}
      `);
  });

  async function checkEpochNumber () {
    (await rootchain.currentEpoch())
      .should.be.bignumber.equal(currentEpoch);
  }

  async function checkEpoch (epochNumber) {
    const [
      requestStart1, requestEnd1, startBlockNumber1, endBlockNumber1, forkedBlockNumber1, firstRequestBlockId1,
      limit1, timestamp1, isEmpty1, initialized1, isRequest1, userActivated1, finalized1,
    ] = await rootchain.epochs(currentFork, epochNumber);

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
        const numBlocks = requestEnd1.sub(requestStart1).add(1).div(MAX_REQUESTS).ceil();
        endBlockNumber1.sub(startBlockNumber1).add(1).should.be.bignumber.equal(numBlocks);
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

    await rootchain.submitNRB(statesRoot, transactionsRoot, intermediateStatesRoot, { value: COST_NRB });
    currentBlockNumber += 1;

    await checkBlockNumber();
  }

  async function submitDummyORB () {
    await checkBlockNumber();

    await rootchain.submitORB(statesRoot, transactionsRoot, intermediateStatesRoot, { value: COST_ORB });
    currentBlockNumber += 1;

    await checkBlockNumber();
  }

  async function applyRequests () {
    // finalize blocks until all blocks are fianlized
    while (true) {
      const lastFinalizedBlock = await rootchain.lastFinalizedBlock(currentFork);
      if (lastFinalizedBlock.equals(currentBlockNumber)) {
        break;
      }
      await timeout(CP_COMPUTATION);
      await rootchain.finalizeBlock();
    }

    for (const requestId of range(requestIdToApply, numRequests)) {
      const [
        timestamp1, isExit1, isTransfer1, finalized1, challenged1, value1, requestor1, to1, trieKey1, trieValue1,
      ] = await rootchain.EROs(requestId);

      finalized1.should.be.equal(false);

      const etherAmount1 = await web3.eth.getBalance(to1);
      const tokenAmount1 = await token.balances(to1);

      const e = await expectEvent.inTransaction(rootchain.applyRequest(), 'RequestFinalized');

      const [
        timestamp2, isExit2, isTransfer2, finalized2, challenged2, value2, requestor2, to2, trieKey2, trieValue2,
      ] = await rootchain.EROs(requestId);

      finalized2.should.be.equal(true);

      const etherAmount2 = await web3.eth.getBalance(to1);
      const tokenAmount2 = await token.balances(to1);

      if (isExit1) {
        if (isTransfer1) {
          etherAmount2.should.be.bignumber.equal(etherAmount1.add(value1));
        } else {
          tokenAmount2.should.be.bignumber.equal(tokenAmount1.add(parseInt(trieValue1, 16)));
        }
      }
      requestIdToApply = e.args.requestId.toNumber() + 1;
    }
  }

  async function logEpochAndBlock (epochNumber) {
    // TODO: refactor me!
    /*
    return;
    console.log(`
      epoch#${currentEpoch} ${await rootchain.epochs(currentFork, epochNumber)}
      ORBs.length: ${await rootchain.getNumORBs()}
      `);
    const [
      requestStart1, requestEnd1, startBlockNumber1, endBlockNumber1, forkedBlockNumber1, firstRequestBlockId1,
      limit1, timestamp1, isEmpty1, initialized1, isRequest1, userActivated1, finalized1,
    ] = await rootchain.epochs(currentFork, epochNumber);

    for (const i of range(startBlockNumber1.toNumber(), endBlockNumber1.toNumber() + 1)) {
      console.log(`
        block#${i} ${await rootchain.blocks(currentFork, i)}`);
    }
    */
  }

  const testEpochsWithoutRequest = (NRBEPochNumber) => {
    const ORBEPochNumber = NRBEPochNumber + 1;

    before(`check NRB epoch#${NRBEPochNumber} parameters`, async () => {
      await checkState(State.AcceptingNRB);
      await checkBlockNumber();
      await checkEpochNumber();

      await checkEpoch(currentEpoch);
    });

    it(`next empty ORB epoch#${ORBEPochNumber} should be prepared`, async () => {
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

    it('can finalize a block', async () => {
      await timeout(CP_COMPUTATION);
      await rootchain.finalizeBlock();
    });
  };

  const testEpochsWithRequest = (NRBEPochNumber) => {
    const ORBEPochNumber = NRBEPochNumber + 1;

    before(`check NRB epoch#${NRBEPochNumber} parameters`, async () => {
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

    it('can finalize a block', async () => {
      const lastFinalizedBlock = await rootchain.lastFinalizedBlock(currentFork);

      await timeout(CP_COMPUTATION);
      await rootchain.finalizeBlock();

      (await rootchain.lastFinalizedBlock(currentFork)).should.be.bignumber.gt(lastFinalizedBlock);
    });

    it('should finalize requests', applyRequests);
  };

  const testEpochsWithExitRequest = (NRBEPochNumber) => {
    const ORBEPochNumber = NRBEPochNumber + 1;

    before(async () => {
      console.log(`
        epoch#${currentEpoch - 1} ${await rootchain.epochs(currentFork, currentEpoch - 1)}
        epoch#${currentEpoch} ${await rootchain.epochs(currentFork, currentEpoch)}
        `);
    });

    it(`NRBEpoch#${NRBEPochNumber}: user can make an exit request for ether withdrawal `, async () => {
      const isTransfer = true;

      (await rootchain.getNumEROs()).should.be.bignumber.equal(numRequests);
      const numORBs = await rootchain.getNumORBs();

      await Promise.all(others.map(other =>
        rootchain.startExit(isTransfer, other, etherAmount, emptyBytes32, emptyBytes32, {
          from: other,
          value: COST_ERU,
        })
      ));

      (await rootchain.getNumORBs()).should.be.bignumber.equal(numORBs.add(1));

      numRequests += others.length;

      (await rootchain.getNumEROs()).should.be.bignumber.equal(numRequests);
    });

    it(`NRBEpoch#${NRBEPochNumber}: user can make an exit request for token withdrawal`, async () => {
      const isTransfer = false;

      const exitAmount = etherAmount.add(COST_ERO);

      (await rootchain.getNumEROs()).should.be.bignumber.equal(numRequests);

      await Promise.all(others.map(other =>
        rootchain.startExit(isTransfer, token.address, 0, emptyBytes32, emptyBytes32, { from: other, value: COST_ERU })
      ));

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

    it('can finalize a block', async () => {
      const lastFinalizedBlock = await rootchain.lastFinalizedBlock(currentFork);

      await timeout(CP_COMPUTATION);
      await rootchain.finalizeBlock();

      (await rootchain.lastFinalizedBlock(currentFork)).should.be.bignumber.gt(lastFinalizedBlock);
    });

    it('should finalize requests', applyRequests);
  };

  describe('Epoch#1', () => {
    const epochNumber = 1;
    testEpochsWithRequest(epochNumber);
  });

  describe('Epoch#3', () => {
    const epochNumber = 3;
    testEpochsWithExitRequest(epochNumber);
  });

  describe('Epoch#5', () => {
    const epochNumber = 5;
    testEpochsWithoutRequest(epochNumber);
  });

  describe('Epoch#7', () => {
    const epochNumber = 7;
    testEpochsWithRequest(epochNumber);
  });

  describe('Epoch#9', () => {
    const epochNumber = 9;
    testEpochsWithRequest(epochNumber);
  });

  describe('Epoch#11', () => {
    const epochNumber = 11;
    testEpochsWithRequest(epochNumber);
  });

  describe('Epoch#13', () => {
    const epochNumber = 13;
    testEpochsWithoutRequest(epochNumber);
  });

  describe('Epoch#15', () => {
    const epochNumber = 15;
    testEpochsWithRequest(epochNumber);
  });

  describe('Epoch#17', () => {
    const epochNumber = 17;
    testEpochsWithExitRequest(epochNumber);
  });
});

function timeout (sec) {
  return new Promise((resolve) => {
    setTimeout(resolve, sec);
  });
}

function calcTrieKey (addr) {
  return web3.sha3(appendHex(padLeft(addr), padLeft('0x02')), { encoding: 'hex' });
}
