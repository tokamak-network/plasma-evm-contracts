const { range } = require('lodash');
const expectEvent = require('openzeppelin-solidity/test/helpers/expectEvent');

const RootChain = artifacts.require('RootChain.sol');
const RequestableSimpleToken = artifacts.require('RequestableSimpleToken.sol');

require('chai')
  .use(require('chai-bignumber')(web3.BigNumber))
  .should();

const BigNumber = web3.BigNumber;

const etherAmount = new BigNumber(10e18);
const tokenAmount = new BigNumber(10e18);
const emptyBytes32 = '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000';

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

    await Promise.all(others.map(other => token.mint(other, tokenAmount)));
    await rootchain.mapRequestableContractByOperator(token.address, tokenInChildChain);

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
      requestStart1, requestEnd1, startBlockNumber1, endBlockNumber1, forkedBlockNumber1, firstRequestBlockId1, limit1, timestamp1, isEmpty1, initialized1, isRequest1, userActivated1, finalized1,
    ] = await rootchain.epochs(currentFork, epochNumber);

    if (epochNumber == 1) { // first NRB epoch
      startBlockNumber1.should.be.bignumber.equal(1);
      endBlockNumber1.should.be.bignumber.equal(NRBEpochLength);
      isRequest1.should.be.equal(false);
      isEmpty1.should.be.equal(false);
    } else if (epochNumber == 2) { // second ORB epoch
      if (isEmpty1) {
        startBlockNumber1.should.be.bignumber.equal(NRBEpochLength);
        endBlockNumber1.should.be.bignumber.equal(startBlockNumber1);
      } else {
        startBlockNumber1.should.be.bignumber.equal(NRBEpochLength.add(1));
        endBlockNumber1.should.be.bignumber.equal(startBlockNumber1.add(NRBEpochLength).sub(1));
      }
      isRequest1.should.be.equal(true);
    } else if (epochNumber > 2 && isRequest1) { // later request epochs
      // previous non request epoch
      const [
        requestStart2, requestEnd2, startBlockNumber2, endBlockNumber2, forkedBlockNumber2, firstRequestBlockId2, limit2, timestamp2, isEmpty2, initialized2, isRequest2, userActivated2, finalized2,
      ] = await rootchain.epochs(currentFork, epochNumber - 1);

      if (isEmpty1) {
        startBlockNumber1.should.be.bignumber.equal(endBlockNumber2);
        endBlockNumber1.should.be.bignumber.equal(startBlockNumber1);

        // previous request epoch
        const [
          requestStart3, requestEnd3, startBlockNumber3, endBlockNumber3, forkedBlockNumber3, firstRequestBlockId3, limit3, timestamp3, isEmpty3, initialized3, isRequest3, userActivated3, finalized3,
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
        requestStart2, requestEnd2, startBlockNumber2, endBlockNumber2, forkedBlockNumber2, firstRequestBlockId2, limit2, timestamp2, isEmpty2, initialized2, isRequest2, userActivated2, finalized2,
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
      const [ , isExit, applied1, finalized1, , value, requestor, to, , ] = await rootchain.EROs(requestId);

      if (!isExit) {
        applied1.should.be.equal(true);
      }
      finalized1.should.be.equal(false);

      const etherAmount1 = await web3.eth.getBalance(to);

      const e = await expectEvent.inTransaction(rootchain.applyRequest(), 'RequestFinalized');

      const [ , , applied2, finalized2, , , , , , ] = await rootchain.EROs(requestId);

      applied2.should.be.equal(true);
      finalized2.should.be.equal(true);

      const etherAmount2 = await web3.eth.getBalance(to);

      if (isExit) {
        etherAmount2.should.be.bignumber.equal(etherAmount1.add(value));
      }
      requestIdToApply = e.args.requestId.toNumber() + 1;
    }
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

    it(`NRBEpoch#${NRBEPochNumber}: user can make a enter request`, async () => {
      (await rootchain.getNumEROs()).should.be.bignumber.equal(numRequests);

      await Promise.all(others.map(other =>
        rootchain.startEnter(other, emptyBytes32, emptyBytes32, { from: other, value: etherAmount })
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
      const [requestStart, requestEnd, startBlockNumber, endBlockNumber, forkedBlockNumber, isEmpty, initialized, isRequest, userActivated, finalized] =
        await rootchain.getEpoch(currentFork, currentEpoch);

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

    it(`NRBEpoch#${NRBEPochNumber}: user can make a enter request`, async () => {
      (await rootchain.getNumEROs()).should.be.bignumber.equal(numRequests);

      await Promise.all(others.map(other =>
        rootchain.startEnter(other, emptyBytes32, emptyBytes32, { from: other, value: etherAmount })
      ));

      numRequests += others.length;

      (await rootchain.getNumEROs()).should.be.bignumber.equal(numRequests);
    });

    it(`NRBEpoch#${NRBEPochNumber}: user can make a exit request`, async () => {
      const exitAmount = etherAmount.add(COST_ERO);

      (await rootchain.getNumEROs()).should.be.bignumber.equal(numRequests);

      await Promise.all(others.map(other =>
        rootchain.startExit(other, emptyBytes32, emptyBytes32, { from: other, value: exitAmount })
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
      const [requestStart, requestEnd, startBlockNumber, endBlockNumber, forkedBlockNumber, isEmpty, initialized, isRequest, userActivated, finalized] =
        await rootchain.getEpoch(currentFork, currentEpoch);

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
  };

  describe('Epoch#1', () => {
    const epochNumber = 1;
    testEpochsWithoutRequest(epochNumber);
  });

  describe('Epoch#3', () => {
    const epochNumber = 3;
    testEpochsWithoutRequest(epochNumber);
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
