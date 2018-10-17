const { range } = require('lodash');
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
  const currentFork = 0;
  let currentEpoch = 1;
  let currentBlockNumber = 0;

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
  });

  async function checkEpochNumber () {
    (await rootchain.currentEpoch())
      .should.be.bignumber.equal(currentEpoch);
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

  describe('Epoch#1', async () => {
    before('check NRB epoch#1 parameters', async () => {
      await checkState(State.AcceptingNRB);
      await checkBlockNumber();

      const [requestStart, requestEnd, startBlockNumber, endBlockNumber, forkedBlockNumber, isEmpty, initialized, isRequest, userActivated, finalized] =
        await rootchain.getEpoch(currentFork, currentEpoch);

      startBlockNumber.should.be.bignumber.equal(currentBlockNumber + 1);
      endBlockNumber.should.be.bignumber.equal(startBlockNumber.add(NRBEpochLength).sub(1));
    });

    it('next empty ORB epoch#2 should be prepared', async () => {
      // submits `NRBEpochLength` NRBs
      await Promise.all(range(NRBEpochLength).map(submitDummyNRB));

      currentEpoch += 2;

      // because no ERO, ORB epoch is empty
      await checkEpochNumber();
      await checkState(State.AcceptingNRB);
    });

    after('check ORB epoch#2 parameters', async () => {
      const [requestStart, requestEnd, startBlockNumber, endBlockNumber, forkedBlockNumber, isEmpty, initialized, isRequest, userActivated, finalized] =
        await rootchain.getEpoch(currentFork, currentEpoch - 1);

      startBlockNumber.should.be.bignumber.equal(currentBlockNumber);
      endBlockNumber.should.be.bignumber.equal(endBlockNumber);
      isEmpty.should.be.equal(true);
    });
  });

  describe('Epoch#3', async () => {
    before('check parameters', async () => {
      await checkState(State.AcceptingNRB);
      await checkBlockNumber();

      const [requestStart, requestEnd, startBlockNumber, endBlockNumber, forkedBlockNumber, isEmpty, initialized, isRequest, userActivated, finalized] =
        await rootchain.getEpoch(currentFork, currentEpoch);

      startBlockNumber.should.be.bignumber.equal(currentBlockNumber + 1);
      endBlockNumber.should.be.bignumber.equal(startBlockNumber.add(NRBEpochLength).sub(1));
    });

    it('next empty ORB epoch#4 should be prepared', async () => {
      // submits `NRBEpochLength` NRBs
      await Promise.all(range(NRBEpochLength).map(submitDummyNRB));

      currentEpoch += 2;

      // because no ERO, ORB epoch is empty
      await checkEpochNumber();
      await checkState(State.AcceptingNRB);
    });

    after('check ORB epoch#4 parameters', async () => {
      const [requestStart, requestEnd, startBlockNumber, endBlockNumber, forkedBlockNumber, isEmpty, initialized, isRequest, userActivated, finalized] =
        await rootchain.getEpoch(currentFork, currentEpoch - 1);

      startBlockNumber.should.be.bignumber.equal(currentBlockNumber);
      endBlockNumber.should.be.bignumber.equal(endBlockNumber);
      isEmpty.should.be.equal(true);
    });
  });

  describe('Epoch#5', async () => {
    before('check parameters', async () => {
      await checkState(State.AcceptingNRB);
      await checkBlockNumber();

      const [requestStart, requestEnd, startBlockNumber, endBlockNumber, forkedBlockNumber, isEmpty, initialized, isRequest, userActivated, finalized] =
        await rootchain.getEpoch(currentFork, currentEpoch);

      startBlockNumber.should.be.bignumber.equal(currentBlockNumber + 1);
      endBlockNumber.should.be.bignumber.equal(startBlockNumber.add(NRBEpochLength).sub(1));
    });

    it('next empty ORB epoch#4 should be prepared', async () => {
      // submits `NRBEpochLength` NRBs
      await Promise.all(range(NRBEpochLength).map(submitDummyNRB));

      currentEpoch += 2;

      // because no ERO, ORB epoch is empty
      await checkEpochNumber();
      await checkState(State.AcceptingNRB);
    });

    after('check ORB epoch#4 parameters', async () => {
      const [requestStart, requestEnd, startBlockNumber, endBlockNumber, forkedBlockNumber, isEmpty, initialized, isRequest, userActivated, finalized] =
        await rootchain.getEpoch(currentFork, currentEpoch - 1);

      startBlockNumber.should.be.bignumber.equal(currentBlockNumber);
      endBlockNumber.should.be.bignumber.equal(endBlockNumber);
      isEmpty.should.be.equal(true);
    });
  });

  describe('Epoch#7', async () => {
    it('user can make a enter request', async () => {
      (await rootchain.getNumEROs()).should.be.bignumber.equal(0);

      await Promise.all(others.map(other =>
        rootchain.startEnter(other, emptyBytes32, emptyBytes32, { from: other, value: etherAmount })
      ));

      (await rootchain.getNumEROs()).should.be.bignumber.equal(others.length);
    });

    it('operator submits NRBs', async () => {
      await Promise.all(range(NRBEpochLength).map(submitDummyNRB));
      currentEpoch += 1;
      await checkEpochNumber();
      await checkState(State.AcceptingORB);
    });

    it('operator submits ORBs', async () => {
      const [requestStart, requestEnd, startBlockNumber, endBlockNumber, forkedBlockNumber, isEmpty, initialized, isRequest, userActivated, finalized] =
        await rootchain.getEpoch(currentFork, currentEpoch);

      const numORBs = endBlockNumber.sub(startBlockNumber).add(1);
      await Promise.all(range(numORBs).map(submitDummyORB));

      currentEpoch += 1;
      await checkEpochNumber();
      await checkState(State.AcceptingNRB);
    });
  });
});
