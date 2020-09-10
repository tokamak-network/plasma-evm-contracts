const { range, last, first } = require('lodash');
const {
  BN, ether, time,
  expectEvent, expectRevert,
} = require('openzeppelin-test-helpers');
const chai = require('chai');
chai.use(require('chai-bn')(BN));

const { padLeft } = require('./helpers/pad');
const { appendHex } = require('./helpers/appendHex');
const { marshalString, unmarshalString } = require('./helpers/marshal');

const { expect } = chai;

const Layer2 = artifacts.require('Layer2.sol');
const TON = artifacts.require('TON.sol');
const EtherToken = artifacts.require('EtherToken.sol');
const RequestableSimpleToken = artifacts.require('RequestableSimpleToken.sol');

const LOGTX = process.env.LOGTX || false;
const VERBOSE = process.env.VERBOSE || false;

const dummyStatesRoot = '0xdb431b544b2f5468e3f771d7843d9c5df3b4edcf8bc1c599f18f0b4ea8709bc3';
const dummyTransactionsRoot = '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421';
const dummyReceiptsRoot = '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421';

const etherAmount = ether('10');
const tokenAmount = ether('10');
const exitAmount = tokenAmount.div(new BN('1000'));
const emptyBytes32 = 0;

// eslint-disable-next-line max-len
const failedReceipt = '0xf9010800825208b9010000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c0';
const dummyProof = '0x00';

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

  // account parameters
  others = others.slice(0, 10);
  const users = others.slice(0, 4);
  const submiter = users[0]; // URB submiter

  // layer2 parameters
  let MAX_REQUESTS;
  let NRELength; // === 2
  let COST_ERO, COST_ERU, COST_URB_PREPARE, COST_URB, COST_ORB, COST_NRB;
  let CP_COMPUTATION, CP_WITHHOLDING, CP_EXIT;

  // test variables
  let currentFork = 0;

  const numEROs = 0;
  const numERUs = 0;

  const EROToApply = 0;
  const ERUToApply = 0;

  const forks = [];
  forks.push({
    firstBlock: 0,
    lastBlock: 0,
    firstEpoch: 0,
    lastEpoch: 0,
    lastFinalizedBlock: 0,
    forkedBlock: 0,
  });

  async function newFork () {
    await timeout(1);
    const lastFinalizedBlock = last(forks).lastFinalizedBlock;

    const firstBlock = lastFinalizedBlock + 1;
    const firstEpoch = (await layer2.getBlock(currentFork, firstBlock)).epochNumber.toNumber();

    currentFork += 1;
    forks.push({
      firstBlock: firstBlock,
      lastBlock: 0,
      firstEpoch: firstEpoch,
      lastEpoch: firstEpoch,
      lastFinalizedBlock: lastFinalizedBlock,
    });
    forks[currentFork - 1].forkedBlock = firstBlock;

    log(`[Added fork]: ${JSON.stringify(last(forks))}`);
  }

  before(async () => {
    if (others.length !== 10) {
      throw new Error(`This test requires at least 11 accounts. but provided ${1 + others.length} accounts`);
    }

    layer2 = await Layer2.deployed();
    mintableToken = await TON.deployed();
    etherToken = await EtherToken.deployed();
    token = await RequestableSimpleToken.new();

    // mint tokens
    await Promise.all(others.map(other => token.mint(other, tokenAmount.mul(new BN('100)))')))));
    await Promise.all(others.map(other => mintableToken.mint(other, tokenAmount.mul(new BN('100)))')))));

    // swap TON to EtherToken
    await Promise.all(others.map(async (other) => {
      await mintableToken.approve(etherToken.address, tokenAmount.mul(new BN('100)))')), { from: other });
      await etherToken.deposit(tokenAmount.mul(new BN('100)))')), { from: other });
    }));

    await layer2.mapRequestableContractByOperator(etherToken.address, etherToken.address);
    await layer2.mapRequestableContractByOperator(token.address, tokenInChildChain);

    // read parameters
    MAX_REQUESTS = await layer2.MAX_REQUESTS();
    NRELength = await layer2.NRELength();
    COST_ERO = await layer2.COST_ERO();
    COST_ERU = await layer2.COST_ERU();
    COST_URB_PREPARE = await layer2.COST_URB_PREPARE();
    COST_URB = await layer2.COST_URB();
    COST_ORB = await layer2.COST_ORB();
    COST_NRB = await layer2.COST_NRB();
    CP_COMPUTATION = (await layer2.CP_COMPUTATION()).toNumber();
    CP_WITHHOLDING = (await layer2.CP_WITHHOLDING()).toNumber();
    CP_EXIT = (await layer2.CP_EXIT()).toNumber();

    log(`
      EpochHandler contract at ${await layer2.epochHandler()}
      Layer2 contract at ${layer2.address}

      MAX_REQUESTS        ${Number(MAX_REQUESTS)}
      NRELength           ${Number(NRELength)}
      COST_ERO            ${Number(COST_ERO)}
      COST_ERU            ${Number(COST_ERU)}
      COST_URB_PREPARE    ${Number(COST_URB_PREPARE)}
      COST_URB            ${Number(COST_URB)}
      COST_ORB            ${Number(COST_ORB)}
      COST_NRB            ${Number(COST_NRB)}
      CP_COMPUTATION      ${Number(CP_COMPUTATION)}
      CP_WITHHOLDING      ${Number(CP_WITHHOLDING)}
      CP_EXIT             ${Number(CP_EXIT)}
      `);

    const targetEvents = [
      'BlockSubmitted',
      'EpochPrepared',
      'BlockFinalized',
      'EpochFinalized',
      'EpochRebased',
      'RequestCreated',
      'RequestFinalized',
      'RequestChallenged',
      'Forked',
    ];

    const eventHandlers = {
      // 'BlockFinalized': (e) => {
      //   const forkNumber = e.args.forkNumber.toNumber();
      //   const blockNumber = e.args.blockNumber.toNumber();
      //   forks[forkNumber].lastFinalizedBlock = blockNumber;
      // },
      // 'EpochFinalized': (e) => {
      //   const forkNumber = e.args.forkNumber.toNumber();
      //   const endBlockNumber = e.args.endBlockNumber.toNumber();
      //   forks[forkNumber].lastFinalizedBlock = endBlockNumber;
      // },
    };

    // TODO: event listening doesn't work...
    if (VERBOSE) {
      // layer2.allEvents().on('data', (e) => {
      //   const eventName = e.event;
      //   console.log(`[${eventName}]: ${JSON.stringify(e.args)}`, e);
      // });

      for (const eventName of targetEvents) {
        layer2[eventName]().on('data', (e) => {
          log(`[${eventName}]: ${JSON.stringify(e.args)}`, e);

          if (typeof eventHandlers[eventName] === 'function') {
            eventHandlers[eventName](e);
          }
        });
      }
    }
  });

  async function checkRequestBlock (blockNumber) {
    const forkNumber = currentFork;
    const fork = forks[forkNumber];

    const block = await layer2.getBlock(forkNumber, blockNumber);
    const epoch = await layer2.getEpoch(forkNumber, block.epochNumber);
    const requestBlock = await layer2.ORBs(block.requestBlockId);

    let perviousEpochNumber = block.epochNumber.sub(new BN('2'));
    let perviousEpoch = await layer2.getEpoch(forkNumber, perviousEpochNumber);

    // in case of first ORE after forked (not ORE')
    if (forkNumber !== 0 && block.epochNumber.cmp(fork.firstEpoch + 4) === 0) {
      perviousEpochNumber = block.epochNumber.sub(new BN('3'));
      perviousEpoch = await layer2.getEpoch(forkNumber, perviousEpochNumber);
    }

    const firstFilledORENumber = await layer2.firstFilledORENumber(currentFork);

    // if (!epoch.rebase) {
    //   await logEpoch(forkNumber, perviousEpochNumber);
    // }

    await logEpoch(forkNumber, perviousEpochNumber);
    await logEpoch(forkNumber, block.epochNumber);
    await logBlock(forkNumber, blockNumber);
    log(`      RequestBlock#${block.requestBlockId} ${JSON.stringify(requestBlock)}`);

    expect(block.isRequest).to.equal(true);
    expect(epoch.isRequest).to.equal(true);
    expect(epoch.isEmpty).to.equal(false);

    const offset = new BN(blockNumber).sub(new BN(epoch.startBlockNumber));
    expect(new BN(block.requestBlockId)).to.be.bignumber.equal(epoch.RE.firstRequestBlockId.add(offset));

    // check previous and current epoch wrt delayed request
    (async function () {
      if (!epoch.rebase) {
        // check ORE

        // check ORE#2
        if (perviousEpochNumber.cmp(0) === 0) {
          expect(epoch.RE.firstRequestBlockId).to.be.equal(String(0));
          expect(epoch.RE.requestStart).to.be.equal(String(0));
          expect(epoch.RE.requestEnd).to.be.equal(String(0));
          expect(epoch.isEmpty).to.equal(true);
          return;
        }

        if (firstFilledORENumber.cmp(block.epochNumber) === 0) {
          expect(perviousEpoch.initialized).to.equal(true);
          expect(perviousEpoch.isRequest).to.equal(true);

          // this epoch is the first request epoch
          expect(await layer2.firstFilledORENumber(forkNumber)).to.be.bignumber.equal(block.epochNumber);
        }

        if (perviousEpoch.isEmpty) {
          if (epoch.isEmpty || perviousEpoch.RE.firstRequestBlockId.cmp(0) === 0) {
            expect(new BN(epoch.RE.firstRequestBlockId)).to.be.bignumber.equal(perviousEpoch.RE.firstRequestBlockId);
          } else {
            expect(new BN(epoch.RE.firstRequestBlockId)).to.be.bignumber.equal(perviousEpoch.RE.firstRequestBlockId.add(new BN('1')));
          }
        } else {
          // previous request epoch is not empty
          const numPreviousBlocks = perviousEpoch.endBlockNumber.sub(perviousEpoch.startBlockNumber).add(new BN('1'));
          const expectedFirstRequestBlockId = perviousEpoch.RE.firstRequestBlockId.add(numPreviousBlocks);

          expect(new BN(epoch.RE.firstRequestBlockId)).to.be.bignumber.equal(expectedFirstRequestBlockId);
        }
      } else {
        // check ORE'
        // check only if ORE' is filled
        if (epoch.endBlockNumber.cmp(0) !== 0) {
          const previousForkNumber = forkNumber - 1;
          const previousFork = forks[previousForkNumber];
          const forkedBlock = await layer2.getBlock(previousForkNumber, previousFork.forkedBlock);

          const previousEpochNumbers = range(forkedBlock.epochNumber, previousFork.lastEpoch + 1);
          const previousEpochs = await Promise.all(previousEpochNumbers
            .map(epochNumber => layer2.getEpoch(previousForkNumber, epochNumber)));

          const previousRequestEpochs = [];
          const proms = [];
          for (const i of range(previousEpochs.length)) {
            const e = previousEpochs[i];
            if (e.isRequest && !e.isEmpty) {
              const n = previousEpochNumbers[i];

              proms.push(logEpoch(previousForkNumber, n));
              previousRequestEpochs.push({ epochNumber: n, epoch: e });
            }
          }

          // log all previous request epochs
          await proms;
          const noRequestEpoch = previousRequestEpochs.length === 0;
          expect(noRequestEpoch).to.be.equal(false);

          const firstRequestEpochAfterFork = first(previousRequestEpochs).epoch;
          const lastRequestEpochAfterFork = last(previousRequestEpochs).epoch;

          expect(new BN(epoch.RE.requestStart)).to.be.bignumber.equal(firstRequestEpochAfterFork.RE.requestStart);
          expect(new BN(epoch.RE.requestEnd)).to.be.bignumber.equal(lastRequestEpochAfterFork.RE.requestEnd);

          // test previous block and referenceBlock
          let currentBlockNumber = Number(blockNumber);
          for (const e of previousRequestEpochs) {
            const referenceEpoch = e.epoch;
            for (const referenceBlockNumber of range(
              referenceEpoch.startBlockNumber.toNumber(), referenceEpoch.endBlockNumber.toNumber())) {
              const referenceBlock = await layer2.getBlock(previousForkNumber, referenceBlockNumber);
              const currentBlock = await layer2.getBlock(currentFork, currentBlockNumber);
              expect(new BN(currentBlock.referenceBlock)).to.be.bignumber.equal(referenceBlockNumber);
              expect(new BN(currentBlock.requestBlockId)).to.be.bignumber.equal(referenceBlock.requestBlockId);

              currentBlockNumber += 1;
            }
          }
        }
      }
    })();

    // check request block
    const numBlocks = epoch.endBlockNumber.sub(epoch.startBlockNumber).add(new BN('1'));
    expect(new BN(block.requestBlockId)).to.be.bignumber.gte(epoch.RE.firstRequestBlockId);
    expect(new BN(block.requestBlockId)).to.be.bignumber.lessThan(epoch.RE.firstRequestBlockId.add(numBlocks));
    expect(new BN(epoch.RE.requestStart)).to.be.bignumber.lte(requestBlock.requestStart);
    expect(new BN(epoch.RE.requestEnd)).to.be.bignumber.gte(requestBlock.requestEnd);
  }

  async function checkLastBlockNumber () {
    expect(await layer2.lastBlock(currentFork))
      .to.be.bignumber.equal(String(forks[currentFork].lastBlock));
  }

  function makePos (v1, v2) { return web3.utils.toBN(v1).shln(128).add(web3.utils.toBN(v2)); }

  function joinEpochRoots (roots) {
    return web3.utils.soliditySha3(marshalString(
      roots.map(unmarshalString).reduce((a, b) => a + b, ''),
    ));
  }

  async function submitDummyNRE (numBlocks) {
    await checkLastBlockNumber();

    const pos1 = makePos(currentFork, forks[currentFork].lastEpoch + 1);
    const pos2 = makePos(forks[currentFork].lastBlock + 1, forks[currentFork].lastBlock + numBlocks);

    // console.log('forks[currentFork]', forks[currentFork]);
    // console.log('numBlocks', numBlocks);

    // console.log('makePos(forks[currentFork].lastBlock + 1, forks[currentFork].lastBlock + numBlocks)', makePos(forks[currentFork].lastBlock + 1, forks[currentFork].lastBlock + numBlocks));
    // console.log('forks[currentFork].lastBlock + 1', forks[currentFork].lastBlock + 1);
    // console.log('forks[currentFork].lastBlock + numBlocks', forks[currentFork].lastBlock + numBlocks);

    const stateRoots = range(numBlocks).map(() => dummyStatesRoot);
    const transactionsRoot = range(numBlocks).map(() => dummyTransactionsRoot);
    const receiptsRoots = range(numBlocks).map(() => dummyReceiptsRoot);

    const epochStateRoot = joinEpochRoots(stateRoots);
    const epochTransactionsRoot = joinEpochRoots(transactionsRoot);
    const epochReceiptsRoots = joinEpochRoots(receiptsRoots);

    forks[currentFork].lastEpoch += 1;
    forks[currentFork].lastBlock += numBlocks;

    // console.log(`
    // pos1                   : ${pos1}
    // pos2                   : ${pos2}
    // epochStateRoot         : ${epochStateRoot}
    // epochTransactionsRoot  : ${epochTransactionsRoot}
    // epochReceiptsRoots     : ${epochReceiptsRoots}
    // `);

    const tx = await layer2.submitNRE(
      pos1,
      pos2,
      epochStateRoot,
      epochTransactionsRoot,
      epochReceiptsRoots,
      { value: COST_NRB },
    );
    logtx(tx);

    await checkLastBlockNumber();
  }

  async function submitDummyORBs (numBlocks) {
    for (const _ of range(numBlocks)) {
      await checkLastBlockNumber();
      forks[currentFork].lastBlock += 1;
      const pos = makePos(currentFork, forks[currentFork].lastBlock);

      const tx = await layer2.submitORB(pos, dummyStatesRoot, dummyTransactionsRoot, dummyReceiptsRoot, { value: COST_ORB });
      logtx(tx);

      await checkRequestBlock(forks[currentFork].lastBlock);
      await checkLastBlockNumber();
    }
  }

  async function submitDummyURBs (numBlocks, firstURB = true) {
    for (const _ of range(numBlocks)) {
      if (firstURB) {
        forks[currentFork].lastBlock = forks[currentFork - 1].lastFinalizedBlock + 1;
      } else {
        forks[currentFork].lastBlock += 1;
      }

      firstURB = false;
      const pos = makePos(currentFork, forks[currentFork].lastBlock);

      const tx = await layer2.submitURB(pos, dummyStatesRoot, dummyTransactionsRoot, dummyReceiptsRoot,
        { from: submiter, value: COST_URB });
      logtx(tx);

      // consume events
      await timeout(3);

      await checkLastBlockNumber();
    }
  }

  async function finalizeBlocks (nTry = 0) {
    // finalize blocks until all blocks are fianlized
    const lastFinalizedBlockNumber = await layer2.getLastFinalizedBlock(currentFork);
    const blockNumberToFinalize = lastFinalizedBlockNumber.add(new BN('1'));
    const block = await layer2.getBlock(currentFork, blockNumberToFinalize);

    // short circuit if all blocks are finalized
    if (lastFinalizedBlockNumber.gte(new BN(forks[currentFork].lastBlock))) {
      return;
    }

    await time.increase(CP_WITHHOLDING + 1);
    await layer2.finalizeBlock();

    forks[currentFork].lastFinalizedBlock = (await layer2.getLastFinalizedBlock(currentFork)).toNumber();

    return finalizeBlocks(nTry + 1);
  }

  async function finalizeRequests (requestIds = []) {
    await finalizeBlocks();

    let requestIdToFinalize = await layer2.EROIdToFinalize();
    const numRequests = await layer2.getNumEROs();

    if (requestIds.length === 0) {
      requestIds = range(requestIdToFinalize, numRequests);
    }

    const lastRequestId = new BN(last(requestIds));

    log('requestIds', requestIds);
    log('requestIdToFinalize', Number(requestIdToFinalize));
    log('lastRequestId', Number(lastRequestId));

    for (const requestId of requestIds) {
      log('requestId', requestId);

      expect(requestIdToFinalize).to.be.bignumber.equal(new BN(requestId));
      await time.increase(CP_EXIT + 1);
      await layer2.finalizeRequest();
      requestIdToFinalize = await layer2.EROIdToFinalize();
    }

    expect(requestIdToFinalize.cmp(lastRequestId) === 0, 'Some requests are not finalized yet');
  }

  async function logEpoch (forkNumber, epochNumber) {
    if (epochNumber < 0) return;

    const epoch = await layer2.getEpoch(forkNumber, epochNumber);
    log(`      Epoch#${forkNumber}.${epochNumber} ${JSON.stringify(epoch)}`);
  }

  async function logBlock (forkNumber, blockNumber) {
    const block = await layer2.getBlock(forkNumber, blockNumber);
    log(`      Block#${forkNumber}.${blockNumber} ${JSON.stringify(block)}`);
  }

  async function logEpochAndBlock (forkNumber, epochNumber) {
    const epoch = await layer2.getEpoch(forkNumber, epochNumber);
    log(`
      Epoch#${forkNumber}.${epochNumber} ${JSON.stringify(epoch)}
      ORBs.length: ${await layer2.getNumORBs()}
      `);

    for (const i of range(
      epoch.startBlockNumber.toNumber(),
      epoch.endBlockNumber.toNumber() + 1,
    )) {
      log(`
        Block#${i} ${JSON.stringify(await layer2.getBlock(forkNumber, i))}`);
    }
  }

  describe('NRE#1 - ORE#2 (empty -> ETH Deposit)', async () => {
    const NRENumber = 1;
    const ORENumber = 2;
    const NextORENumber = ORENumber + 2;

    const NRBNumbers = [1, 2];
    const ORENumbers = [];

    const ORBId = 0;
    const NextORBId = 0;

    const previousRequestIds = [0];
    const requestIds = range(0, 4);

    before('check NRE', async () => {
      expect((await layer2.lastEpoch(0))).to.be.bignumber.equal(String(NRENumber - 1));

      const epoch = await layer2.getEpoch(currentFork, NRENumber);
      expect(epoch.initialized).to.equal(true);
      expect(epoch.isRequest).to.equal(false);
      expect(epoch.isEmpty).to.equal(false);
    });

    it('user can make enter requests for ETH deposit (requests: [0, 4))', async () => {
      const isTransfer = true;

      await Promise.all(users.map(async other => {
        const trieKey = await etherToken.getBalanceTrieKey(other);
        const trieValue = padLeft(web3.utils.numberToHex(etherAmount));

        const tx = await layer2.startEnter(etherToken.address, trieKey, trieValue, {
          from: other,
        });

        logtx(tx);
      }));

      await Promise.all(requestIds.map(async (requestId) => {
        const ERO = await layer2.EROs(requestId);
        expect(ERO.isTransfer).to.equal(isTransfer);
        expect(ERO.finalized).to.equal(false);
        expect(ERO.isExit).to.equal(false);
      }));
    });

    it('operator should submits NRE#1', async () => {
      await submitDummyNRE(NRBNumbers.length);
    });

    it('NRE#1 should have correct blocks', async () => {
      const epoch = await layer2.getEpoch(currentFork, NRENumber);

      expect(epoch.startBlockNumber).to.equal(String(first(NRBNumbers)));
      expect(epoch.endBlockNumber).to.equal(String(last(NRBNumbers)));
    });

    it('ORE#2 should be empty', async () => {
      const epoch = await layer2.getEpoch(currentFork, ORENumber);

      expect(epoch.startBlockNumber).to.be.equal(String(last(NRBNumbers)));
      expect(epoch.endBlockNumber).to.be.equal(String(last(NRBNumbers)));
      expect(epoch.RE.firstRequestBlockId).to.be.equal(String(ORBId));
      expect(epoch.initialized).to.be.equal(true);
      expect(epoch.isRequest).to.be.equal(true);
      expect(epoch.isEmpty).to.be.equal(true);
      expect(epoch.RE.requestStart).to.be.equal(String(first(previousRequestIds)));
      expect(epoch.RE.requestEnd).to.be.equal(String(last(previousRequestIds)));

      forks[currentFork].lastEpoch += 1;
    });

    it('Next request block should be sealed', async () => {
      const requestBlock = await layer2.ORBs(NextORBId);

      expect(requestBlock.submitted).to.be.equal(true);
      expect(requestBlock.requestStart).to.be.bignumber.equal(String(first(requestIds)));
      expect(requestBlock.requestEnd).to.be.bignumber.equal(String(last(requestIds)));
    });

    it('Next ORE#4 should have correct request ids', async () => {
      const epoch = await layer2.getEpoch(currentFork, NextORENumber);

      expect(epoch.isEmpty).to.be.equal(false);
      expect(epoch.RE.requestStart).to.be.equal(String(first(requestIds)));
      expect(epoch.RE.requestEnd).to.be.equal(String(last(requestIds)));
      expect(epoch.RE.firstRequestBlockId).to.be.equal(String(NextORBId));
    });

    it('Blocks should be fianlzied', finalizeBlocks);
  });

  describe('NRE#3 - ORE#4 (ETH Deposit -> Token Deposit)', async () => {
    const NRENumber = 3;
    const ORENumber = 4;
    const NextORENumber = ORENumber + 2;

    const NRBNumbers = [3, 4];
    const ORBNumbers = [5];

    const ORBId = 0;
    const NextORBId = ORBId + 1;

    const previousRequestIds = range(0, 4);
    const requestIds = range(4, 8);

    before('check NRE', async () => {
      expect((await layer2.lastEpoch(0))).to.be.bignumber.equal(String(NRENumber - 1));

      const epoch = await layer2.getEpoch(currentFork, NRENumber);
      expect(epoch.initialized).to.be.equal(true);
      expect(epoch.isRequest).to.be.equal(false);
      expect(epoch.isEmpty).to.be.equal(false);
    });

    it('user can make enter requests for Token deposit (requests: [4, 8))', async () => {
      const isTransfer = false;

      await Promise.all(users.map(async other => {
        const trieKey = await token.getBalanceTrieKey(other);
        const trieValue = padLeft(web3.utils.numberToHex(tokenAmount));

        const tokenBalance = await token.balances(other);

        const tx = await layer2.startEnter(token.address, trieKey, trieValue, { from: other });
        logtx(tx);

        expect((await token.balances(other))).to.be.bignumber.equal(tokenBalance.sub(tokenAmount));
      }));

      await Promise.all(requestIds.map(async (requestId) => {
        const ERO = await layer2.EROs(requestId);

        expect(ERO.isTransfer).to.be.equal(isTransfer);
        expect(ERO.finalized).to.be.equal(false);
        expect(ERO.isExit).to.be.equal(false);
      }));
    });

    it('operator should submits NRE#3', async () => {
      await submitDummyNRE(NRBNumbers.length);
    });

    it('NRE#3 should have correct blocks', async () => {
      const epoch = await layer2.getEpoch(currentFork, NRENumber);

      expect(epoch.startBlockNumber).to.be.equal(String(first(NRBNumbers)));
      expect(epoch.endBlockNumber).to.be.equal(String(last(NRBNumbers)));
    });

    it('operator should submit ORB#5', async () => {
      await submitDummyORBs(1);

      const requestBlock = await layer2.ORBs(ORBId);
      expect(requestBlock.requestStart).to.be.bignumber.equal(String(first(previousRequestIds)));
      expect(requestBlock.requestEnd).to.be.bignumber.equal(String(last(previousRequestIds)));
      expect(requestBlock.submitted).to.be.equal(true);
      // expect(requestBlock.epochNumber).to.be.equal(String(ORENumber));
    });

    it('Next request block should be sealed', async () => {
      const nextRequestBlock = await layer2.ORBs(NextORBId);

      expect(nextRequestBlock.submitted).to.be.equal(true);
      expect(nextRequestBlock.requestStart).to.be.bignumber.equal(String(first(requestIds)));
      expect(nextRequestBlock.requestEnd).to.be.bignumber.equal(String(last(requestIds)));
    });

    it('ORE#4 should have correct blocks', async () => {
      const epoch = await layer2.getEpoch(currentFork, ORENumber);

      expect(epoch.startBlockNumber).to.be.equal(String(first(ORBNumbers)));
      expect(epoch.endBlockNumber).to.be.equal(String(last(ORBNumbers)));
      expect(epoch.RE.firstRequestBlockId).to.be.equal(String(ORBId));

      forks[currentFork].lastEpoch += 1;
    });

    it('ORE#4 should have previous requests', async () => {
      const epoch = await layer2.getEpoch(currentFork, ORENumber);

      expect(epoch.RE.firstRequestBlockId).to.be.equal(String(ORBId));
      expect(epoch.initialized).to.be.equal(true);
      expect(epoch.isRequest).to.be.equal(true);
      expect(epoch.isEmpty).to.be.equal(false);
      expect(epoch.RE.requestStart).to.be.equal(String(first(previousRequestIds)));
      expect(epoch.RE.requestEnd).to.be.equal(String(last(previousRequestIds)));
    });

    it('Next ORE#6 should have correct request ids', async () => {
      const epoch = await layer2.getEpoch(currentFork, NextORENumber);

      expect(epoch.isEmpty).to.be.equal(false);
      expect(epoch.RE.requestStart).to.be.equal(String(first(requestIds)));
      expect(epoch.RE.requestEnd).to.be.equal(String(last(requestIds)));
      expect(epoch.RE.firstRequestBlockId).to.be.equal(String(NextORBId));
    });

    it('Blocks should be fianlzied', finalizeBlocks);
  });

  describe('NRE#5 - ORE#6 (Token Deposit -> empty)', async () => {
    const NRENumber = 5;
    const ORENumber = 6;
    const NextORENumber = ORENumber + 2;

    const NRBNumbers = [6, 7];
    const ORBNumbers = [8];

    const ORBId = 1;
    const NextORBId = ORBId;

    const previousRequestIds = range(4, 8);
    const requestIds = [7];

    before('check NRE', async () => {
      expect((await layer2.lastEpoch(0))).to.be.bignumber.equal(String(NRENumber - 1));

      const epoch = await layer2.getEpoch(currentFork, NRENumber);
      expect(epoch.initialized).to.be.equal(true);
      expect(epoch.isRequest).to.be.equal(false);
      expect(epoch.isEmpty).to.be.equal(false);
    });

    it('operator should submits NRE#5', async () => {
      await submitDummyNRE(NRBNumbers.length);
    });

    it('NRE#5 should have correct blocks', async () => {
      const epoch = await layer2.getEpoch(currentFork, NRENumber);

      expect(epoch.startBlockNumber).to.be.equal(String(first(NRBNumbers)));
      expect(epoch.endBlockNumber).to.be.equal(String(last(NRBNumbers)));
    });

    it('operator should submit ORB#8', async () => {
      await submitDummyORBs(1);

      const requestBlock = await layer2.ORBs(ORBId);
      expect(requestBlock.requestStart).to.be.bignumber.equal(String(first(previousRequestIds)));
      expect(requestBlock.requestEnd).to.be.bignumber.equal(String(last(previousRequestIds)));
      expect(requestBlock.submitted).to.be.equal(true);
      // expect(requestBlock.epochNumber).to.be.bignumber.equal(String(ORENumber));
    });

    it('ORE#6 should have correct blocks', async () => {
      const epoch = await layer2.getEpoch(currentFork, ORENumber);

      expect(epoch.startBlockNumber).to.be.equal(String(first(ORBNumbers)));
      expect(epoch.endBlockNumber).to.be.equal(String(last(ORBNumbers)));
      expect(epoch.RE.firstRequestBlockId).to.be.equal(String(ORBId));

      forks[currentFork].lastEpoch += 1;
    });

    it('ORE#6 should have previous requests', async () => {
      const epoch = await layer2.getEpoch(currentFork, ORENumber);

      expect(epoch.RE.firstRequestBlockId).to.be.equal(String(ORBId));
      expect(epoch.initialized).to.be.equal(true);
      expect(epoch.isRequest).to.be.equal(true);
      expect(epoch.isEmpty).to.be.equal(false);
      expect(epoch.RE.requestStart).to.be.equal(String(first(previousRequestIds)));
      expect(epoch.RE.requestEnd).to.be.equal(String(last(previousRequestIds)));
    });

    it('Next empty ORE#8 should have correct request block id', async () => {
      const epoch = await layer2.getEpoch(currentFork, NextORENumber);

      expect(epoch.isEmpty).to.be.equal(true);
      expect(epoch.RE.requestStart).to.be.equal(String(first(requestIds)));
      expect(epoch.RE.requestEnd).to.be.equal(String(last(requestIds)));
      expect(epoch.RE.firstRequestBlockId).to.be.equal(String(NextORBId));
    });

    it('Blocks should be fianlzied', finalizeBlocks);

    // finalize all requests
    it('Requests should be fianlzied', async () => finalizeRequests());
  });

  describe('NRE#7 - ORE#8 (empty -> token withdrawal)', async () => {
    const NRENumber = 7;
    const ORENumber = 8;
    const NextORENumber = ORENumber + 2;

    const NRBNumbers = [9, 10];
    const ORBNumbers = [];

    const ORBId = 1;
    const NextORBId = ORBId + 1;

    const previousRequestIds = [7];
    const requestIds = range(8, 12);

    before('check NRE', async () => {
      expect((await layer2.lastEpoch(0))).to.be.bignumber.equal(String(NRENumber - 1));

      const epoch = await layer2.getEpoch(currentFork, NRENumber);
      expect(epoch.initialized).to.be.equal(true);
      expect(epoch.isRequest).to.be.equal(false);
      expect(epoch.isEmpty).to.be.equal(false);
    });

    it('user can make exit requests for token withdrawal (requests: [8, 12))', async () => {
      const isTransfer = false;
      const isExit = true;

      await Promise.all(users.map(async other => {
        const trieKey = await token.getBalanceTrieKey(other);
        const trieValue = padLeft(web3.utils.numberToHex(tokenAmount));

        const tx = await layer2.startExit(token.address, trieKey, trieValue, { from: other, value: COST_ERU });
        logtx(tx);
      }));

      await Promise.all(requestIds.map(async (requestId) => {
        const ERO = await layer2.EROs(requestId);

        expect(ERO.isTransfer).to.be.equal(isTransfer);
        expect(ERO.finalized).to.be.equal(false);
        expect(ERO.isExit).to.be.equal(isExit);
      }));
    });

    it('operator should submits NRE#7', async () => {
      await submitDummyNRE(NRBNumbers.length);
    });

    it('NRE#7 should have correct blocks', async () => {
      const epoch = await layer2.getEpoch(currentFork, NRENumber);

      expect(epoch.startBlockNumber).to.be.equal(String(first(NRBNumbers)));
      expect(epoch.endBlockNumber).to.be.equal(String(last(NRBNumbers)));
    });

    it('ORE#8 should be empty', async () => {
      const epoch = await layer2.getEpoch(currentFork, ORENumber);

      expect(epoch.startBlockNumber).to.be.equal(String(last(NRBNumbers)));
      expect(epoch.endBlockNumber).to.be.equal(String(last(NRBNumbers)));
      expect(epoch.RE.firstRequestBlockId).to.be.equal(String(ORBId));
      expect(epoch.initialized).to.be.equal(true);
      expect(epoch.isRequest).to.be.equal(true);
      expect(epoch.isEmpty).to.be.equal(true);
      expect(epoch.RE.requestStart).to.be.equal(String(first(previousRequestIds)));
      expect(epoch.RE.requestEnd).to.be.equal(String(last(previousRequestIds)));

      forks[currentFork].lastEpoch += 1;
    });

    it('Next request block should be sealed', async () => {
      const nextRequestBlock = await layer2.ORBs(NextORBId);
      expect(nextRequestBlock.submitted).to.be.equal(true);
    });

    it('Next ORE#10 should have correct request ids', async () => {
      const epoch = await layer2.getEpoch(currentFork, NextORENumber);

      expect(epoch.isEmpty).to.be.equal(false);
      expect(epoch.RE.requestStart).to.be.equal(String(first(requestIds)));
      expect(epoch.RE.requestEnd).to.be.equal(String(last(requestIds)));
      expect(epoch.RE.firstRequestBlockId).to.be.equal(String(NextORBId));
    });

    it('Blocks should be fianlzied', finalizeBlocks);
  });

  describe('NRE#9 - ORE#10 (token withdrawal -> bulk exit)', async () => {
    const NRENumber = 9;
    const ORENumber = 10;
    const NextORENumber = ORENumber + 2;

    const NRBNumbers = [11, 12];
    const ORBNumbers = [13];

    const ORBId = 2;
    const NextORBIds = [3, 4];

    const previousRequestIds = range(8, 12);
    const requestIds = range(12, 52);

    before('check NRE', async () => {
      expect((await layer2.lastEpoch(0))).to.be.bignumber.equal(String(NRENumber - 1));

      const epoch = await layer2.getEpoch(currentFork, NRENumber);
      expect(epoch.initialized).to.be.equal(true);
      expect(epoch.isRequest).to.be.equal(false);
      expect(epoch.isEmpty).to.be.equal(false);
    });

    it('user can make exit requests for token withdrawal (requests: [12, 52))', async () => {
      const isTransfer = false;
      const isExit = true;

      for (const _ of range(requestIds.length / others.length)) {
        await Promise.all(others.map(async other => {
          const trieKey = await token.getBalanceTrieKey(other);
          const trieValue = padLeft(web3.utils.numberToHex(tokenAmount));

          return layer2.startExit(token.address, trieKey, trieValue, { from: other, value: COST_ERU });
        }));
      }

      const EROs = await Promise.all(requestIds.map(i => layer2.EROs(i)));

      EROs.forEach(ERO => {
        expect(ERO.isTransfer).to.be.equal(isTransfer);
        expect(ERO.finalized).to.be.equal(false);
        expect(ERO.isExit).to.be.equal(isExit);
      });
    });

    it('operator should submits NRE#9', async () => {
      await submitDummyNRE(NRBNumbers.length);
    });

    it('NRE#9 should have correct blocks', async () => {
      const epoch = await layer2.getEpoch(currentFork, NRENumber);

      expect(epoch.startBlockNumber).to.be.equal(String(first(NRBNumbers)));
      expect(epoch.endBlockNumber).to.be.equal(String(last(NRBNumbers)));
    });

    it('operator should submit ORB#13', async () => {
      await submitDummyORBs(1);

      const requestBlock = await layer2.ORBs(ORBId);
      expect(requestBlock.requestStart).to.be.bignumber.equal(String(first(previousRequestIds)));
      expect(requestBlock.requestEnd).to.be.bignumber.equal(String(last(previousRequestIds)));
      expect(requestBlock.submitted).to.be.equal(true);
      // expect(requestBlock.epochNumber).to.be.bignumber.equal(String(ORENumber));
    });

    it('Next request blocks should be sealed', async () => {
      const nextRequestBlock0 = await layer2.ORBs(NextORBIds[0]);
      const nextRequestBlock1 = await layer2.ORBs(NextORBIds[1]);

      expect(nextRequestBlock0.submitted).to.be.equal(true);
      expect(nextRequestBlock1.submitted).to.be.equal(true);
      expect(nextRequestBlock0.requestStart).to.be.bignumber.equal(String(first(requestIds)));
      expect(nextRequestBlock1.requestEnd).to.be.bignumber.equal(String(last(requestIds)));
    });

    it('ORE#10 should have correct blocks', async () => {
      const epoch = await layer2.getEpoch(currentFork, ORENumber);

      expect(epoch.startBlockNumber).to.be.equal(String(first(ORBNumbers)));
      expect(epoch.endBlockNumber).to.be.equal(String(last(ORBNumbers)));
      expect(epoch.RE.firstRequestBlockId).to.be.equal(String(ORBId));

      forks[currentFork].lastEpoch += 1;
    });

    it('ORE#10 should have previous requests', async () => {
      const epoch = await layer2.getEpoch(currentFork, ORENumber);

      expect(epoch.RE.firstRequestBlockId).to.be.equal(String(ORBId));
      expect(epoch.initialized).to.be.equal(true);
      expect(epoch.isRequest).to.be.equal(true);
      expect(epoch.isEmpty).to.be.equal(false);
      expect(epoch.RE.requestStart).to.be.equal(String(first(previousRequestIds)));
      expect(epoch.RE.requestEnd).to.be.equal(String(last(previousRequestIds)));
    });

    it('Next ORE#12 should have correct request ids', async () => {
      const epoch = await layer2.getEpoch(currentFork, NextORENumber);

      expect(epoch.isEmpty).to.be.equal(false);
      expect(epoch.RE.requestStart).to.be.equal(String(first(requestIds)));
      expect(epoch.RE.requestEnd).to.be.equal(String(last(requestIds)));
      expect(epoch.RE.firstRequestBlockId).to.be.equal(String(NextORBIds[0]));
    });

    it('Blocks should be fianlzied', finalizeBlocks);

    it('Requests should be fianlzied', async () => finalizeRequests(previousRequestIds));
  });

  describe('NRE#11 - ORE#12 (bulk request -> bulk requests)', async () => {
    const NRENumber = 11;
    const ORENumber = 12;
    const NextORENumber = ORENumber + 2;

    const NRBNumbers = [14, 15];
    const ORBNumbers = [16, 17];

    const ORBIds = [3, 4];
    const NextORBIds = [5, 6];

    const previousRequestIds = range(12, 52);
    const requestIds = range(52, 80);

    before('check NRE', async () => {
      expect((await layer2.lastEpoch(0))).to.be.bignumber.equal(String(NRENumber - 1));

      const epoch = await layer2.getEpoch(currentFork, NRENumber);
      expect(epoch.initialized).to.be.equal(true);
      expect(epoch.isRequest).to.be.equal(false);
      expect(epoch.isEmpty).to.be.equal(false);
    });

    it('user can make exit requests for token withdrawal (requests: [52, 80))', async () => {
      const isTransfer = false;
      const isExit = true;

      // 20 requests
      for (const _ of range(2)) {
        await Promise.all(others.map(async other => {
          const trieKey = await token.getBalanceTrieKey(other);
          const trieValue = padLeft(web3.utils.numberToHex(tokenAmount));

          return layer2.startExit(token.address, trieKey, trieValue, { from: other, value: COST_ERU });
        }));
      }

      // 8 requests
      await Promise.all(others.slice(0, 8).map(async other => {
        const trieKey = await token.getBalanceTrieKey(other);
        const trieValue = padLeft(web3.utils.numberToHex(tokenAmount));

        return layer2.startExit(token.address, trieKey, trieValue, { from: other, value: COST_ERU });
      }));

      const EROs = await Promise.all(requestIds.map(i => layer2.EROs(i)));

      EROs.forEach(ERO => {
        expect(ERO.isTransfer).to.be.equal(isTransfer);
        expect(ERO.finalized).to.be.equal(false);
        expect(ERO.isExit).to.be.equal(isExit);
      });
    });

    it('operator should submits NRE#11', async () => {
      await submitDummyNRE(NRBNumbers.length);
    });

    it('NRE#11 should have correct blocks', async () => {
      const epoch = await layer2.getEpoch(currentFork, NRENumber);

      expect(epoch.startBlockNumber).to.be.equal(String(first(NRBNumbers)));
      expect(epoch.endBlockNumber).to.be.equal(String(last(NRBNumbers)));
    });

    it('operator should submit ORB#16', async () => {
      await submitDummyORBs(1);

      const requestBlock = await layer2.ORBs(ORBIds[0]);
      expect(requestBlock.requestStart).to.be.bignumber.equal(String(12));
      expect(requestBlock.requestEnd).to.be.bignumber.equal(String(31));
      expect(requestBlock.submitted).to.be.equal(true);
      // expect(requestBlock.epochNumber).to.be.bignumber.equal(String(ORENumber));
    });

    it('operator should submit ORB#17', async () => {
      await submitDummyORBs(1);

      const requestBlock = await layer2.ORBs(ORBIds[1]);
      expect(requestBlock.requestStart).to.be.bignumber.equal(String(32));
      expect(requestBlock.requestEnd).to.be.bignumber.equal(String(51));
      expect(requestBlock.submitted).to.be.equal(true);
      // expect(requestBlock.epochNumber).to.be.bignumber.equal(String(ORENumber));
    });

    it('Next request blocks should be sealed', async () => {
      const nextRequestBlock0 = await layer2.ORBs(NextORBIds[0]);
      const nextRequestBlock1 = await layer2.ORBs(NextORBIds[1]);

      expect(nextRequestBlock0.submitted).to.be.equal(true);
      expect(nextRequestBlock1.submitted).to.be.equal(true);
      expect(nextRequestBlock0.requestStart).to.be.bignumber.equal(String(first(requestIds)));
      expect(nextRequestBlock1.requestEnd).to.be.bignumber.equal(String(last(requestIds)));
    });

    it('ORE#12 should have correct blocks', async () => {
      const epoch = await layer2.getEpoch(currentFork, ORENumber);

      expect(epoch.startBlockNumber).to.be.equal(String(first(ORBNumbers)));
      expect(epoch.endBlockNumber).to.be.equal(String(last(ORBNumbers)));
      expect(epoch.RE.firstRequestBlockId).to.be.equal(String(first(ORBIds)));

      forks[currentFork].lastEpoch += 1;
    });

    it('ORE#12 should have previous requests', async () => {
      const epoch = await layer2.getEpoch(currentFork, ORENumber);

      expect(epoch.RE.firstRequestBlockId).to.be.equal(String(first(ORBIds)));
      expect(epoch.initialized).to.be.equal(true);
      expect(epoch.isRequest).to.be.equal(true);
      expect(epoch.isEmpty).to.be.equal(false);
      expect(epoch.RE.requestStart).to.be.equal(String(first(previousRequestIds)));
      expect(epoch.RE.requestEnd).to.be.equal(String(last(previousRequestIds)));
    });

    it('Next ORE#14 should have correct request ids', async () => {
      const epoch = await layer2.getEpoch(currentFork, NextORENumber);

      expect(epoch.isEmpty).to.be.equal(false);
      expect(epoch.RE.requestStart).to.be.equal(String(first(requestIds)));
      expect(epoch.RE.requestEnd).to.be.equal(String(last(requestIds)));
      expect(epoch.RE.firstRequestBlockId).to.be.equal(String(NextORBIds[0]));
    });

    it('Blocks should be fianlzied', finalizeBlocks);

    it('Requests should be fianlzied', async () => finalizeRequests(previousRequestIds));
  });

  describe('NRE#13 - ORE#14 (bulk request -> empty)', async () => {
    const NRENumber = 13;
    const ORENumber = 14;
    const NextORENumber = ORENumber + 2;

    const NRBNumbers = [18, 19];
    const ORBNumbers = [20, 21];

    const ORBIds = [5, 6];
    const NextORBId = last(ORBIds);

    const previousRequestIds = range(52, 80);
    const requestIds = [79];

    before('check NRE', async () => {
      expect((await layer2.lastEpoch(0))).to.be.bignumber.equal(String(NRENumber - 1));

      const epoch = await layer2.getEpoch(currentFork, NRENumber);
      expect(epoch.initialized).to.be.equal(true);
      expect(epoch.isRequest).to.be.equal(false);
      expect(epoch.isEmpty).to.be.equal(false);
    });

    it('operator should submits NRE#13', async () => {
      await submitDummyNRE(NRBNumbers.length);
    });

    it('NRE#13 should have correct blocks', async () => {
      const epoch = await layer2.getEpoch(currentFork, NRENumber);

      expect(epoch.startBlockNumber).to.be.equal(String(first(NRBNumbers)));
      expect(epoch.endBlockNumber).to.be.equal(String(last(NRBNumbers)));
    });

    it('operator should submit ORB#20', async () => {
      await submitDummyORBs(1);

      const requestBlock = await layer2.ORBs(ORBIds[0]);
      expect(requestBlock.requestStart).to.be.bignumber.equal(String(52));
      expect(requestBlock.requestEnd).to.be.bignumber.equal(String(71));
      expect(requestBlock.submitted).to.be.equal(true);
      // expect(requestBlock.epochNumber).to.be.bignumber.equal(String(ORENumber));
    });

    it('operator should submit ORB#21', async () => {
      await submitDummyORBs(1);

      const requestBlock = await layer2.ORBs(ORBIds[1]);
      expect(requestBlock.requestStart).to.be.bignumber.equal(String(72));
      expect(requestBlock.requestEnd).to.be.bignumber.equal(String(79));
      expect(requestBlock.submitted).to.be.equal(true);
      // expect(requestBlock.epochNumber).to.be.bignumber.equal(String(ORENumber));
    });

    it('ORE#14 should have correct blocks', async () => {
      const epoch = await layer2.getEpoch(currentFork, ORENumber);

      expect(epoch.startBlockNumber).to.be.equal(String(first(ORBNumbers)));
      expect(epoch.endBlockNumber).to.be.equal(String(last(ORBNumbers)));
      expect(epoch.RE.firstRequestBlockId).to.be.equal(String(first(ORBIds)));

      forks[currentFork].lastEpoch += 1;
    });

    it('ORE#14 should have previous requests', async () => {
      const epoch = await layer2.getEpoch(currentFork, ORENumber);

      expect(epoch.RE.firstRequestBlockId).to.be.equal(String(first(ORBIds)));
      expect(epoch.initialized).to.be.equal(true);
      expect(epoch.isRequest).to.be.equal(true);
      expect(epoch.isEmpty).to.be.equal(false);
      expect(epoch.RE.requestStart).to.be.equal(String(first(previousRequestIds)));
      expect(epoch.RE.requestEnd).to.be.equal(String(last(previousRequestIds)));
    });

    it('Next empty ORE#16 should have correct request ids', async () => {
      const epoch = await layer2.getEpoch(currentFork, NextORENumber);

      expect(epoch.isEmpty).to.be.equal(true);
      expect(epoch.RE.requestStart).to.be.equal(String(first(requestIds)));
      expect(epoch.RE.requestEnd).to.be.equal(String(last(requestIds)));
      expect(epoch.RE.firstRequestBlockId).to.be.equal(String(NextORBId));
    });

    it('Blocks should be fianlzied', finalizeBlocks);

    it('Requests should be fianlzied', async () => finalizeRequests(previousRequestIds));
  });

  describe('NRE#15 - ORE#16 (empty -> empty)', async () => {
    const NRENumber = 15;
    const ORENumber = 16;
    const NextORENumber = ORENumber + 2;

    const NRBNumbers = [22, 23];

    const ORBId = 6;
    const NextORBId = ORBId;

    const previousRequestIds = [79];
    const requestIds = previousRequestIds;

    before('check NRE', async () => {
      expect((await layer2.lastEpoch(0))).to.be.bignumber.equal(String(NRENumber - 1));

      const epoch = await layer2.getEpoch(currentFork, NRENumber);
      expect(epoch.initialized).to.be.equal(true);
      expect(epoch.isRequest).to.be.equal(false);
      expect(epoch.isEmpty).to.be.equal(false);
    });

    it('operator should submits NRE#15', async () => {
      await submitDummyNRE(NRBNumbers.length);
    });

    it('NRE#15 should have correct blocks', async () => {
      const epoch = await layer2.getEpoch(currentFork, NRENumber);

      expect(epoch.startBlockNumber).to.be.equal(String(first(NRBNumbers)));
      expect(epoch.endBlockNumber).to.be.equal(String(last(NRBNumbers)));
    });

    it('ORE#16 should be empty', async () => {
      const epoch = await layer2.getEpoch(currentFork, ORENumber);

      expect(epoch.startBlockNumber).to.be.equal(String(last(NRBNumbers)));
      expect(epoch.endBlockNumber).to.be.equal(String(last(NRBNumbers)));
      expect(epoch.RE.firstRequestBlockId).to.be.equal(String(ORBId));
      expect(epoch.initialized).to.be.equal(true);
      expect(epoch.isRequest).to.be.equal(true);
      expect(epoch.isEmpty).to.be.equal(true);
      expect(epoch.RE.requestStart).to.be.equal(String(first(previousRequestIds)));
      expect(epoch.RE.requestEnd).to.be.equal(String(last(previousRequestIds)));

      forks[currentFork].lastEpoch += 1;
    });

    it('Next empty ORE#18 should have correct request ids', async () => {
      const epoch = await layer2.getEpoch(currentFork, NextORENumber);

      expect(epoch.isEmpty).to.be.equal(true);
      expect(epoch.RE.requestStart).to.be.equal(String(first(requestIds)));
      expect(epoch.RE.requestEnd).to.be.equal(String(last(requestIds)));
      expect(epoch.RE.firstRequestBlockId).to.be.equal(String(NextORBId));
    });

    it('Blocks should be fianlzied', finalizeBlocks);
  });

  describe('NRE#17 - ORE#18 (empty -> empty)', async () => {
    const NRENumber = 17;
    const ORENumber = 18;
    const NextORENumber = ORENumber + 2;

    const NRBNumbers = [24, 25];

    const ORBId = 6;
    const NextORBId = ORBId;

    const previousRequestIds = [79];
    const requestIds = previousRequestIds;

    before('check NRE', async () => {
      expect((await layer2.lastEpoch(0))).to.be.bignumber.equal(String(NRENumber - 1));

      const epoch = await layer2.getEpoch(currentFork, NRENumber);
      expect(epoch.initialized).to.be.equal(true);
      expect(epoch.isRequest).to.be.equal(false);
      expect(epoch.isEmpty).to.be.equal(false);
    });

    it('operator should submits NRE#17', async () => {
      await submitDummyNRE(NRBNumbers.length);
    });

    it('NRE#17 should have correct blocks', async () => {
      const epoch = await layer2.getEpoch(currentFork, NRENumber);

      expect(epoch.startBlockNumber).to.be.equal(String(first(NRBNumbers)));
      expect(epoch.endBlockNumber).to.be.equal(String(last(NRBNumbers)));
    });

    it('ORE#18 should be empty', async () => {
      const epoch = await layer2.getEpoch(currentFork, ORENumber);

      expect(epoch.startBlockNumber).to.be.equal(String(last(NRBNumbers)));
      expect(epoch.endBlockNumber).to.be.equal(String(last(NRBNumbers)));
      expect(epoch.RE.firstRequestBlockId).to.be.equal(String(ORBId));
      expect(epoch.initialized).to.be.equal(true);
      expect(epoch.isRequest).to.be.equal(true);
      expect(epoch.isEmpty).to.be.equal(true);
      expect(epoch.RE.requestStart).to.be.equal(String(first(previousRequestIds)));
      expect(epoch.RE.requestEnd).to.be.equal(String(last(previousRequestIds)));

      forks[currentFork].lastEpoch += 1;
    });

    it('Next empty ORE#20 should have correct request ids', async () => {
      const epoch = await layer2.getEpoch(currentFork, NextORENumber);

      expect(epoch.isEmpty).to.be.equal(true);
      expect(epoch.RE.requestStart).to.be.equal(String(first(requestIds)));
      expect(epoch.RE.requestEnd).to.be.equal(String(last(requestIds)));
      expect(epoch.RE.firstRequestBlockId).to.be.equal(String(NextORBId));
    });

    it('Blocks should be fianlzied', finalizeBlocks);
  });

  describe('NRE#19 - ORE#20 (empty -> bulk request)', async () => {
    const NRENumber = 19;
    const ORENumber = 20;
    const NextORENumber = ORENumber + 2;

    const NRBNumbers = [26, 27];

    // previous non-empty request epoch has 2 blocks where ORB ids = [5, 6]
    const ORBId = 6;
    const NextORBIds = [7, 8];

    const previousRequestIds = [79];
    const requestIds = range(80, 120);

    before('check NRE', async () => {
      expect((await layer2.lastEpoch(0))).to.be.bignumber.equal(String(NRENumber - 1));

      const epoch = await layer2.getEpoch(currentFork, NRENumber);
      expect(epoch.initialized).to.be.equal(true);
      expect(epoch.isRequest).to.be.equal(false);
      expect(epoch.isEmpty).to.be.equal(false);
    });

    it('user can make exit requests for token withdrawal (requests: [80, 120))', async () => {
      const isTransfer = false;
      const isExit = true;

      for (const _ of range(requestIds.length / others.length)) {
        await Promise.all(others.map(async other => {
          const trieKey = await token.getBalanceTrieKey(other);
          const trieValue = padLeft(web3.utils.numberToHex(tokenAmount));

          return layer2.startExit(token.address, trieKey, trieValue, { from: other, value: COST_ERU });
        }));
      }

      const EROs = await Promise.all(requestIds.map(i => layer2.EROs(i)));

      EROs.forEach(ERO => {
        expect(ERO.isTransfer).to.be.equal(isTransfer);
        expect(ERO.finalized).to.be.equal(false);
        expect(ERO.isExit).to.be.equal(isExit);
      });
    });

    it('operator should submits NRE#19', async () => {
      await submitDummyNRE(NRBNumbers.length);
    });

    it('NRE#19 should have correct blocks', async () => {
      const epoch = await layer2.getEpoch(currentFork, NRENumber);

      expect(epoch.startBlockNumber).to.be.equal(String(first(NRBNumbers)));
      expect(epoch.endBlockNumber).to.be.equal(String(last(NRBNumbers)));
    });

    it('ORE#20 should be empty', async () => {
      const epoch = await layer2.getEpoch(currentFork, ORENumber);

      expect(epoch.startBlockNumber).to.be.equal(String(last(NRBNumbers)));
      expect(epoch.endBlockNumber).to.be.equal(String(last(NRBNumbers)));
      expect(epoch.RE.firstRequestBlockId).to.be.equal(String(ORBId));
      expect(epoch.initialized).to.be.equal(true);
      expect(epoch.isRequest).to.be.equal(true);
      expect(epoch.isEmpty).to.be.equal(true);
      expect(epoch.RE.requestStart).to.be.equal(String(first(previousRequestIds)));
      expect(epoch.RE.requestEnd).to.be.equal(String(last(previousRequestIds)));

      forks[currentFork].lastEpoch += 1;
    });

    it('Next request blocks should be sealed', async () => {
      const nextRequestBlock0 = await layer2.ORBs(NextORBIds[0]);
      const nextRequestBlock1 = await layer2.ORBs(NextORBIds[1]);

      expect(nextRequestBlock0.submitted).to.be.equal(true);
      expect(nextRequestBlock1.submitted).to.be.equal(true);
      expect(nextRequestBlock0.requestStart).to.be.bignumber.equal(String(first(requestIds)));
      expect(nextRequestBlock1.requestEnd).to.be.bignumber.equal(String(last(requestIds)));
    });

    it('Next empty ORE#22 should have correct request ids', async () => {
      const epoch = await layer2.getEpoch(currentFork, NextORENumber);

      expect(epoch.isEmpty).to.be.equal(false);
      expect(epoch.RE.requestStart).to.be.equal(String(first(requestIds)));
      expect(epoch.RE.requestEnd).to.be.equal(String(last(requestIds)));
      expect(epoch.RE.firstRequestBlockId).to.be.equal(String(first(NextORBIds)));
    });

    it('Blocks should be fianlzied', finalizeBlocks);
  });

  describe('NRE#21 - ORE#22 (bulk request -> empty)', async () => {
    const NRENumber = 21;
    const ORENumber = 22;
    const NextORENumber = ORENumber + 2;

    const NRBNumbers = [28, 29];
    const ORBNumbers = [30, 31];

    const ORBIds = [7, 8];
    const NextORBId = last(ORBIds);

    const previousRequestIds = range(80, 120);
    const requestIds = [119];

    before('check NRE', async () => {
      expect((await layer2.lastEpoch(0))).to.be.bignumber.equal(String(NRENumber - 1));

      const epoch = await layer2.getEpoch(currentFork, NRENumber);
      expect(epoch.initialized).to.be.equal(true);
      expect(epoch.isRequest).to.be.equal(false);
      expect(epoch.isEmpty).to.be.equal(false);
    });

    it('operator should submits NRE#21', async () => {
      await submitDummyNRE(NRBNumbers.length);
    });

    it('NRE#21 should have correct blocks', async () => {
      const epoch = await layer2.getEpoch(currentFork, NRENumber);

      expect(epoch.startBlockNumber).to.be.equal(String(first(NRBNumbers)));
      expect(epoch.endBlockNumber).to.be.equal(String(last(NRBNumbers)));
    });

    it('operator should submit ORB#30', async () => {
      await submitDummyORBs(1);

      const requestBlock = await layer2.ORBs(ORBIds[0]);
      expect(requestBlock.requestStart).to.be.bignumber.equal(String(80));
      expect(requestBlock.requestEnd).to.be.bignumber.equal(String(99));
      expect(requestBlock.submitted).to.be.equal(true);
      // expect(requestBlock.epochNumber).to.be.bignumber.equal(String(ORENumber));
    });

    it('operator should submit ORB#31', async () => {
      await submitDummyORBs(1);

      const requestBlock = await layer2.ORBs(ORBIds[1]);
      expect(requestBlock.requestStart).to.be.bignumber.equal(String(100));
      expect(requestBlock.requestEnd).to.be.bignumber.equal(String(119));
      expect(requestBlock.submitted).to.be.equal(true);
      // expect(requestBlock.epochNumber).to.be.bignumber.equal(String(ORENumber));
    });

    it('ORE#22 should have correct blocks', async () => {
      const epoch = await layer2.getEpoch(currentFork, ORENumber);

      expect(epoch.startBlockNumber).to.be.equal(String(first(ORBNumbers)));
      expect(epoch.endBlockNumber).to.be.equal(String(last(ORBNumbers)));
      expect(epoch.RE.firstRequestBlockId).to.be.equal(String(first(ORBIds)));

      forks[currentFork].lastEpoch += 1;
    });

    it('ORE#22 should have previous requests', async () => {
      const epoch = await layer2.getEpoch(currentFork, ORENumber);

      expect(epoch.RE.firstRequestBlockId).to.be.equal(String(first(ORBIds)));
      expect(epoch.initialized).to.be.equal(true);
      expect(epoch.isRequest).to.be.equal(true);
      expect(epoch.isEmpty).to.be.equal(false);
      expect(epoch.RE.requestStart).to.be.equal(String(first(previousRequestIds)));
      expect(epoch.RE.requestEnd).to.be.equal(String(last(previousRequestIds)));
    });

    it('Next empty ORE#24 should have correct request ids', async () => {
      const epoch = await layer2.getEpoch(currentFork, NextORENumber);

      expect(epoch.isEmpty).to.be.equal(true);
      expect(epoch.RE.requestStart).to.be.equal(String(first(requestIds)));
      expect(epoch.RE.requestEnd).to.be.equal(String(last(requestIds)));
      expect(epoch.RE.firstRequestBlockId).to.be.equal(String(NextORBId));
    });

    it('Blocks should be fianlzied', finalizeBlocks);

    it('Requests should be fianlzied', async () => finalizeRequests(previousRequestIds));
  });

  describe('finalization', async () => {
    // it('block should be fianlzied', finalizeBlocks);
    it('Requests should be fianlzied', async () => finalizeRequests());
  });
});

function timeout (sec) {
  return new Promise((resolve) => {
    setTimeout(resolve, sec * 1000);
  });
}

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
