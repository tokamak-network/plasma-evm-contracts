const { range, last, first } = require('lodash');
const { BN, ether,
  latestTime, increaseTime, increaseTimeTo,
  expectEvent, expectRevert,
} = require('openzeppelin-test-helpers');
const chai = require('chai');
chai.use(require('chai-bn')(BN));

const { padLeft } = require('./helpers/pad');
const { appendHex } = require('./helpers/appendHex');

const { expect } = chai;

const RootChain = artifacts.require('RootChain.sol');
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

contract('RootChain', async ([
  operator,
  ...others
]) => {
  let rootchain;
  let token, mintableToken, etherToken;

  const tokenInChildChain = '0x000000000000000000000000000000000000dead';

  // account parameters
  others = others.slice(0, 10);
  const users = others.slice(0, 4);
  const submiter = users[0]; // URB submiter

  // rootchain parameters
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
    const firstEpoch = (await rootchain.getBlock(currentFork, firstBlock)).epochNumber.toNumber();

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

    rootchain = await RootChain.deployed();
    mintableToken = await ERC20Mintable.deployed();
    etherToken = await EtherToken.deployed();
    token = await RequestableSimpleToken.new();

    // mint tokens
    await Promise.all(others.map(other => token.mint(other, tokenAmount.mul(new BN('100)))')))));
    await Promise.all(others.map(other => mintableToken.mint(other, tokenAmount.mul(new BN('100)))')))));

    // swap ERC20Mintable to EtherToken
    await Promise.all(others.map(async (other) => {
      await mintableToken.approve(etherToken.address, tokenAmount.mul(new BN('100)))')), { from: other });
      await etherToken.deposit(tokenAmount.mul(new BN('100)))')), { from: other });
    }));

    await rootchain.mapRequestableContractByOperator(etherToken.address, etherToken.address);
    await rootchain.mapRequestableContractByOperator(token.address, tokenInChildChain);

    // read parameters
    MAX_REQUESTS = await rootchain.MAX_REQUESTS();
    NRELength = await rootchain.NRELength();
    COST_ERO = await rootchain.COST_ERO();
    COST_ERU = await rootchain.COST_ERU();
    COST_URB_PREPARE = await rootchain.COST_URB_PREPARE();
    COST_URB = await rootchain.COST_URB();
    COST_ORB = await rootchain.COST_ORB();
    COST_NRB = await rootchain.COST_NRB();
    CP_COMPUTATION = (await rootchain.CP_COMPUTATION()).toNumber();
    CP_WITHHOLDING = (await rootchain.CP_WITHHOLDING()).toNumber();
    CP_EXIT = (await rootchain.CP_EXIT()).toNumber();

    log(`
      EpochHandler contract at ${await rootchain.epochHandler()}
      RootChain contract at ${rootchain.address}

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
      rootchain.allEvents().on('data', (e) => {
        const eventName = e.event;
        console.log(`[${eventName}]: ${JSON.stringify(e.args)}`, e);
      });

      // for (const eventName of targetEvents) {
      //   rootchain[eventName]().on('data', (e) => {
      //     console.log("New Event!");
      //     log(`[${eventName}]: ${JSON.stringify(e.args)}`, e);

      //     if (typeof eventHandlers[eventName] === 'function') {
      //       eventHandlers[eventName](e);
      //     }
      //   });
      // }
    }
  });

  async function checkRequestBlock (blockNumber) {
    const forkNumber = currentFork;
    const fork = forks[forkNumber];

    const block = await rootchain.getBlock(forkNumber, blockNumber);
    const epoch = await rootchain.getEpoch(forkNumber, block.epochNumber);
    const requestBlock = await rootchain.ORBs(block.requestBlockId);

    let perviousEpochNumber = block.epochNumber.sub(new BN('2'));
    let perviousEpoch = await rootchain.getEpoch(forkNumber, perviousEpochNumber);

    // in case of first ORE after forked (not ORE')
    if (forkNumber !== 0 && block.epochNumber.cmp(fork.firstEpoch + 4) === 0) {
      perviousEpochNumber = block.epochNumber.sub(new BN('3'));
      perviousEpoch = await rootchain.getEpoch(forkNumber, perviousEpochNumber);
    }

    const firstFilledORENumber = await rootchain.firstFilledORENumber(currentFork);

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

    // check previous and current epoch wrt delayed request
    (async function () {
      if (!epoch.rebase) {
        // check ORE

        // check ORE#2
        if (perviousEpochNumber.cmp(0) === 0) {
          expect(epoch.firstRequestBlockId).to.be.equal(String(0));
          expect(epoch.requestStart).to.be.equal(String(0));
          expect(epoch.requestEnd).to.be.equal(String(0));
          expect(epoch.isEmpty).to.equal(true);
          return;
        }

        if (firstFilledORENumber.cmp(block.epochNumber) === 0) {
          expect(perviousEpoch.initialized).to.equal(true);
          expect(perviousEpoch.isRequest).to.equal(true);

          // this epoch is the first request epoch
          expect(await rootchain.firstFilledORENumber(forkNumber)).to.be.bignumber.equal(block.epochNumber);
        }

        if (perviousEpoch.isEmpty) {
          if (epoch.isEmpty || perviousEpoch.firstRequestBlockId.cmp(0) === 0) {
            expect(new BN(epoch.firstRequestBlockId)).to.be.bignumber.equal(perviousEpoch.firstRequestBlockId);
          } else {
            expect(new BN(epoch.firstRequestBlockId)).to.be.bignumber.equal(perviousEpoch.firstRequestBlockId.add(new BN('1')));
          }
        } else {
          // previous request epoch is not empty
          const numPreviousBlocks = perviousEpoch.endBlockNumber.sub(perviousEpoch.startBlockNumber).add(new BN('1'));
          const expectedFirstRequestBlockId = perviousEpoch.firstRequestBlockId.add(numPreviousBlocks);

          expect(new BN(epoch.firstRequestBlockId)).to.be.bignumber.equal(expectedFirstRequestBlockId);
        }
      } else {
        // check ORE'
        // check only if ORE' is filled
        if (epoch.endBlockNumber.cmp(0) !== 0) {
          const previousForkNumber = forkNumber - 1;
          const previousFork = forks[previousForkNumber];
          const forkedBlock = await rootchain.getBlock(previousForkNumber, previousFork.forkedBlock);

          const previousEpochNumbers = range(forkedBlock.epochNumber, previousFork.lastEpoch + 1);
          const previousEpochs = await Promise.all(previousEpochNumbers
            .map(epochNumber => rootchain.getEpoch(previousForkNumber, epochNumber)));

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

          expect(new BN(epoch.requestStart)).to.be.bignumber.equal(firstRequestEpochAfterFork.requestStart);
          expect(new BN(epoch.requestEnd)).to.be.bignumber.equal(lastRequestEpochAfterFork.requestEnd);

          // test previous block and referenceBlock
          let currentBlockNumber = Number(blockNumber);
          for (const e of previousRequestEpochs) {
            const referenceEpoch = e.epoch;
            for (const referenceBlockNumber of range(
              referenceEpoch.startBlockNumber.toNumber(), referenceEpoch.endBlockNumber.toNumber())) {
              const referenceBlock = await rootchain.getBlock(previousForkNumber, referenceBlockNumber);
              const currentBlock = await rootchain.getBlock(currentFork, currentBlockNumber);
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
    expect(new BN(block.requestBlockId)).to.be.bignumber.gte(epoch.firstRequestBlockId);
    expect(new BN(block.requestBlockId)).to.be.bignumber.lessThan(epoch.firstRequestBlockId.add(numBlocks));
    expect(new BN(epoch.requestStart)).to.be.bignumber.lte(requestBlock.requestStart);
    expect(new BN(epoch.requestEnd)).to.be.bignumber.gte(requestBlock.requestEnd);
  }

  async function checkLastBlockNumber () {
    expect(await rootchain.lastBlock(currentFork))
      .to.be.bignumber.equal(String(forks[currentFork].lastBlock));
  }

  function makePos (forkNumber, blockNumber) {
    return forkNumber * (1 << 128) + blockNumber;
  }

  async function submitDummyNRBs (numBlocks) {
    for (const _ of range(numBlocks)) {
      await checkLastBlockNumber();
      forks[currentFork].lastBlock += 1;
      const pos = makePos(currentFork, forks[currentFork].lastBlock);

      const tx = await rootchain.submitNRB(pos, dummyStatesRoot, dummyTransactionsRoot, dummyReceiptsRoot, { value: COST_NRB });
      logtx(tx);

      await checkLastBlockNumber();
    }
  }

  async function submitDummyORBs (numBlocks) {
    for (const _ of range(numBlocks)) {
      await checkLastBlockNumber();
      forks[currentFork].lastBlock += 1;
      const pos = makePos(currentFork, forks[currentFork].lastBlock);

      const tx = await rootchain.submitORB(pos, dummyStatesRoot, dummyTransactionsRoot, dummyReceiptsRoot, { value: COST_ORB });
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

      const tx = await rootchain.submitURB(pos, dummyStatesRoot, dummyTransactionsRoot, dummyReceiptsRoot,
        { from: submiter, value: COST_URB });
      logtx(tx);

      // consume events
      await timeout(3);

      await checkLastBlockNumber();
    }
  }

  async function finalizeBlocks () {
    // finalize blocks until all blocks are fianlized
    const lastFinalizedBlockNumber = await rootchain.getLastFinalizedBlock(currentFork);
    const blockNumberToFinalize = lastFinalizedBlockNumber.add(new BN('1'));
    const block = await rootchain.getBlock(currentFork, blockNumberToFinalize);

    // short circuit if all blocks are finalized
    if (lastFinalizedBlockNumber.gte(forks[currentFork].lastBlock)) {
      return;
    }

    const finalizedAt = block.timestamp.add(CP_WITHHOLDING.add(new BN('1')));

    if (await latestTime() < finalizedAt) {
      await increaseTimeTo(finalizedAt);
    }
    await rootchain.finalizeBlock();

    forks[currentFork].lastFinalizedBlock = (await rootchain.getLastFinalizedBlock(currentFork)).toNumber();

    return finalizeBlocks();
  }

  async function logEpoch (forkNumber, epochNumber) {
    if (epochNumber < 0) return;

    const epoch = await rootchain.getEpoch(forkNumber, epochNumber);
    log(`      Epoch#${forkNumber}.${epochNumber} ${JSON.stringify(epoch)}`);
  }

  async function logBlock (forkNumber, blockNumber) {
    const block = await rootchain.getBlock(forkNumber, blockNumber);
    log(`      Block#${forkNumber}.${blockNumber} ${JSON.stringify(block)}`);
  }

  async function logEpochAndBlock (forkNumber, epochNumber) {
    const epoch = await rootchain.getEpoch(forkNumber, epochNumber);
    log(`
      Epoch#${forkNumber}.${epochNumber} ${JSON.stringify(epoch)}
      ORBs.length: ${await rootchain.getNumORBs()}
      `);

    for (const i of range(
      epoch.startBlockNumber.toNumber(),
      epoch.endBlockNumber.toNumber() + 1
    )) {
      log(`
        Block#${i} ${JSON.stringify(await rootchain.getBlock(forkNumber, i))}`);
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
      const epoch = await rootchain.getEpoch(currentFork, NRENumber);
      expect(epoch.initialized).to.equal(true);
      expect(epoch.isRequest).to.equal(false);
      expect(epoch.isEmpty).to.equal(false);
    });

    it('operator should submits NRB#1', async () => {
      await submitDummyNRBs(1);
    });

    it('user can make enter requests for ETH deposit (requests: [0, 4))', async () => {
      const isTransfer = true;

      await Promise.all(users.map(async other => {
        const trieKey = await etherToken.getBalanceTrieKey(other);
        const trieValue = padLeft(web3.utils.numberToHex(etherAmount));

        const tx = await rootchain.startEnter(etherToken.address, trieKey, trieValue, {
          from: other,
        });

        logtx(tx);
      }));

      await Promise.all(requestIds.map(async (requestId) => {
        const ERO = await rootchain.EROs(requestId);
        expect(ERO.isTransfer).to.equal(isTransfer);
        expect(ERO.finalized).to.equal(false);
        expect(ERO.isExit).to.equal(false);
      }));
    });

    it('operator should submits NRB#2', async () => {
      await submitDummyNRBs(1);
    });

    it('NRE#1 should have correct blocks', async () => {
      const epoch = await rootchain.getEpoch(currentFork, NRENumber);

      expect(epoch.startBlockNumber).to.equal(String(first(NRBNumbers)));
      expect(epoch.endBlockNumber).to.equal(String(last(NRBNumbers)));
    });

    it('ORE#2 should be empty', async () => {
      const epoch = await rootchain.getEpoch(currentFork, ORENumber);

      expect(epoch.startBlockNumber).to.be.equal(String(last(NRBNumbers)));
      expect(epoch.endBlockNumber).to.be.equal(String(last(NRBNumbers)));
      expect(epoch.firstRequestBlockId).to.be.equal(String(ORBId));
      expect(epoch.initialized).to.be.equal(true);
      expect(epoch.isRequest).to.be.equal(true);
      expect(epoch.isEmpty).to.be.equal(true);
      expect(epoch.requestStart).to.be.equal(String(first(previousRequestIds)));
      expect(epoch.requestEnd).to.be.equal(String(last(previousRequestIds)));
    });

    it('Next request block should be sealed', async () => {
      const requestBlock = await rootchain.ORBs(NextORBId);

      expect(requestBlock.submitted).to.be.equal(true);
      expect(requestBlock.requestStart).to.be.bignumber.equal(String(first(requestIds)));
      expect(requestBlock.requestEnd).to.be.bignumber.equal(String(last(requestIds)));
    });

    it('Next ORE#4 should have correct request ids', async () => {
      const epoch = await rootchain.getEpoch(currentFork, NextORENumber);

      expect(epoch.isEmpty).to.be.equal(false);
      expect(epoch.requestStart).to.be.equal(String(first(requestIds)));
      expect(epoch.requestEnd).to.be.equal(String(last(requestIds)));
      expect(epoch.firstRequestBlockId).to.be.equal(String(NextORBId));
    });
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
      const epoch = await rootchain.getEpoch(currentFork, NRENumber);
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

        const tx = await rootchain.startEnter(token.address, trieKey, trieValue, { from: other });
        logtx(tx);

        expect((await token.balances(other))).to.be.bignumber.equal(tokenBalance.sub(tokenAmount));
      }));

      await Promise.all(requestIds.map(async (requestId) => {
        const ERO = await rootchain.EROs(requestId);

        expect(ERO.isTransfer).to.be.equal(isTransfer);
        expect(ERO.finalized).to.be.equal(false);
        expect(ERO.isExit).to.be.equal(false);
      }));
    });

    it('operator should submits NRB#3', async () => {
      await submitDummyNRBs(1);
    });

    it('operator should submits NRB#4', async () => {
      await submitDummyNRBs(1);
    });

    it('NRE#3 should have correct blocks', async () => {
      const epoch = await rootchain.getEpoch(currentFork, NRENumber);

      expect(epoch.startBlockNumber).to.be.equal(String(first(NRBNumbers)));
      expect(epoch.endBlockNumber).to.be.equal(String(last(NRBNumbers)));
    });

    it('operator should submit ORB#5', async () => {
      await submitDummyORBs(1);

      const requestBlock = await rootchain.ORBs(ORBId);
      expect(requestBlock.requestStart).to.be.bignumber.equal(String(first(previousRequestIds)));
      expect(requestBlock.requestEnd).to.be.bignumber.equal(String(last(previousRequestIds)));
      expect(requestBlock.submitted).to.be.equal(true);
      // expect(requestBlock.epochNumber).to.be.equal(String(ORENumber));
    });

    it('Next request block should be sealed', async () => {
      const nextRequestBlock = await rootchain.ORBs(NextORBId);

      expect(nextRequestBlock.submitted).to.be.equal(true);
      expect(nextRequestBlock.requestStart).to.be.bignumber.equal(String(first(requestIds)));
      expect(nextRequestBlock.requestEnd).to.be.bignumber.equal(String(last(requestIds)));
    });

    it('ORE#4 should have correct blocks', async () => {
      const epoch = await rootchain.getEpoch(currentFork, ORENumber);

      expect(epoch.startBlockNumber).to.be.equal(String(first(ORBNumbers)));
      expect(epoch.endBlockNumber).to.be.equal(String(last(ORBNumbers)));
      expect(epoch.firstRequestBlockId).to.be.equal(String(ORBId));
    });

    it('ORE#4 should have previous requests', async () => {
      const epoch = await rootchain.getEpoch(currentFork, ORENumber);

      expect(epoch.firstRequestBlockId).to.be.equal(String(ORBId));
      expect(epoch.initialized).to.be.equal(true);
      expect(epoch.isRequest).to.be.equal(true);
      expect(epoch.isEmpty).to.be.equal(false);
      expect(epoch.requestStart).to.be.equal(String(first(previousRequestIds)));
      expect(epoch.requestEnd).to.be.equal(String(last(previousRequestIds)));
    });

    it('Next ORE#6 should have correct request ids', async () => {
      const epoch = await rootchain.getEpoch(currentFork, NextORENumber);

      expect(epoch.isEmpty).to.be.equal(false);
      expect(epoch.requestStart).to.be.equal(String(first(requestIds)));
      expect(epoch.requestEnd).to.be.equal(String(last(requestIds)));
      expect(epoch.firstRequestBlockId).to.be.equal(String(NextORBId));
    });
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
      const epoch = await rootchain.getEpoch(currentFork, NRENumber);
      expect(epoch.initialized).to.be.equal(true);
      expect(epoch.isRequest).to.be.equal(false);
      expect(epoch.isEmpty).to.be.equal(false);
    });

    it('operator should submits NRB#6', async () => {
      await submitDummyNRBs(1);
    });

    it('operator should submits NRB#7', async () => {
      await submitDummyNRBs(1);
    });

    it('NRE#5 should have correct blocks', async () => {
      const epoch = await rootchain.getEpoch(currentFork, NRENumber);

      expect(epoch.startBlockNumber).to.be.equal(String(first(NRBNumbers)));
      expect(epoch.endBlockNumber).to.be.equal(String(last(NRBNumbers)));
    });

    it('operator should submit ORB#8', async () => {
      await submitDummyORBs(1);

      const requestBlock = await rootchain.ORBs(ORBId);
      expect(requestBlock.requestStart).to.be.bignumber.equal(String(first(previousRequestIds)));
      expect(requestBlock.requestEnd).to.be.bignumber.equal(String(last(previousRequestIds)));
      expect(requestBlock.submitted).to.be.equal(true);
      // expect(requestBlock.epochNumber).to.be.bignumber.equal(String(ORENumber));
    });

    it('ORE#6 should have correct blocks', async () => {
      const epoch = await rootchain.getEpoch(currentFork, ORENumber);

      expect(epoch.startBlockNumber).to.be.equal(String(first(ORBNumbers)));
      expect(epoch.endBlockNumber).to.be.equal(String(last(ORBNumbers)));
      expect(epoch.firstRequestBlockId).to.be.equal(String(ORBId));
    });

    it('ORE#6 should have previous requests', async () => {
      const epoch = await rootchain.getEpoch(currentFork, ORENumber);

      expect(epoch.firstRequestBlockId).to.be.equal(String(ORBId));
      expect(epoch.initialized).to.be.equal(true);
      expect(epoch.isRequest).to.be.equal(true);
      expect(epoch.isEmpty).to.be.equal(false);
      expect(epoch.requestStart).to.be.equal(String(first(previousRequestIds)));
      expect(epoch.requestEnd).to.be.equal(String(last(previousRequestIds)));
    });

    it('Next empty ORE#8 should have correct request block id', async () => {
      const epoch = await rootchain.getEpoch(currentFork, NextORENumber);

      expect(epoch.isEmpty).to.be.equal(true);
      expect(epoch.requestStart).to.be.equal(String(first(requestIds)));
      expect(epoch.requestEnd).to.be.equal(String(last(requestIds)));
      expect(epoch.firstRequestBlockId).to.be.equal(String(NextORBId));
    });
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
      const epoch = await rootchain.getEpoch(currentFork, NRENumber);
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

        const tx = await rootchain.startExit(token.address, trieKey, trieValue, { from: other, value: COST_ERU });
        logtx(tx);
      }));

      await Promise.all(requestIds.map(async (requestId) => {
        const ERO = await rootchain.EROs(requestId);

        expect(ERO.isTransfer).to.be.equal(isTransfer);
        expect(ERO.finalized).to.be.equal(false);
        expect(ERO.isExit).to.be.equal(isExit);
      }));
    });

    it('operator should submits NRB#9', async () => {
      await submitDummyNRBs(1);
    });

    it('operator should submits NRB#10', async () => {
      await submitDummyNRBs(1);
    });

    it('NRE#7 should have correct blocks', async () => {
      const epoch = await rootchain.getEpoch(currentFork, NRENumber);

      expect(epoch.startBlockNumber).to.be.equal(String(first(NRBNumbers)));
      expect(epoch.endBlockNumber).to.be.equal(String(last(NRBNumbers)));
    });

    it('ORE#8 should be empty', async () => {
      const epoch = await rootchain.getEpoch(currentFork, ORENumber);

      expect(epoch.startBlockNumber).to.be.equal(String(last(NRBNumbers)));
      expect(epoch.endBlockNumber).to.be.equal(String(last(NRBNumbers)));
      expect(epoch.firstRequestBlockId).to.be.equal(String(ORBId));
      expect(epoch.initialized).to.be.equal(true);
      expect(epoch.isRequest).to.be.equal(true);
      expect(epoch.isEmpty).to.be.equal(true);
      expect(epoch.requestStart).to.be.equal(String(first(previousRequestIds)));
      expect(epoch.requestEnd).to.be.equal(String(last(previousRequestIds)));
    });

    it('Next request block should be sealed', async () => {
      const nextRequestBlock = await rootchain.ORBs(NextORBId);
      expect(nextRequestBlock.submitted).to.be.equal(true);
    });

    it('Next ORE#10 should have correct request ids', async () => {
      const epoch = await rootchain.getEpoch(currentFork, NextORENumber);

      expect(epoch.isEmpty).to.be.equal(false);
      expect(epoch.requestStart).to.be.equal(String(first(requestIds)));
      expect(epoch.requestEnd).to.be.equal(String(last(requestIds)));
      expect(epoch.firstRequestBlockId).to.be.equal(String(NextORBId));
    });
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
      const epoch = await rootchain.getEpoch(currentFork, NRENumber);
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

          return rootchain.startExit(token.address, trieKey, trieValue, { from: other, value: COST_ERU });
        }));
      }

      const EROs = await Promise.all(requestIds.map(i => rootchain.EROs(i)));

      EROs.forEach(ERO => {
        expect(ERO.isTransfer).to.be.equal(isTransfer);
        expect(ERO.finalized).to.be.equal(false);
        expect(ERO.isExit).to.be.equal(isExit);
      });
    });

    it('operator should submits NRB#11', async () => {
      await submitDummyNRBs(1);
    });

    it('operator should submits NRB#12', async () => {
      await submitDummyNRBs(1);
    });

    it('NRE#9 should have correct blocks', async () => {
      const epoch = await rootchain.getEpoch(currentFork, NRENumber);

      expect(epoch.startBlockNumber).to.be.equal(String(first(NRBNumbers)));
      expect(epoch.endBlockNumber).to.be.equal(String(last(NRBNumbers)));
    });

    it('operator should submit ORB#13', async () => {
      await submitDummyORBs(1);

      const requestBlock = await rootchain.ORBs(ORBId);
      expect(requestBlock.requestStart).to.be.bignumber.equal(String(first(previousRequestIds)));
      expect(requestBlock.requestEnd).to.be.bignumber.equal(String(last(previousRequestIds)));
      expect(requestBlock.submitted).to.be.equal(true);
      // expect(requestBlock.epochNumber).to.be.bignumber.equal(String(ORENumber));
    });

    it('Next request blocks should be sealed', async () => {
      const nextRequestBlock0 = await rootchain.ORBs(NextORBIds[0]);
      const nextRequestBlock1 = await rootchain.ORBs(NextORBIds[1]);

      expect(nextRequestBlock0.submitted).to.be.equal(true);
      expect(nextRequestBlock1.submitted).to.be.equal(true);
      expect(nextRequestBlock0.requestStart).to.be.bignumber.equal(String(first(requestIds)));
      expect(nextRequestBlock1.requestEnd).to.be.bignumber.equal(String(last(requestIds)));
    });

    it('ORE#10 should have correct blocks', async () => {
      const epoch = await rootchain.getEpoch(currentFork, ORENumber);

      expect(epoch.startBlockNumber).to.be.equal(String(first(ORBNumbers)));
      expect(epoch.endBlockNumber).to.be.equal(String(last(ORBNumbers)));
      expect(epoch.firstRequestBlockId).to.be.equal(String(ORBId));
    });

    it('ORE#10 should have previous requests', async () => {
      const epoch = await rootchain.getEpoch(currentFork, ORENumber);

      expect(epoch.firstRequestBlockId).to.be.equal(String(ORBId));
      expect(epoch.initialized).to.be.equal(true);
      expect(epoch.isRequest).to.be.equal(true);
      expect(epoch.isEmpty).to.be.equal(false);
      expect(epoch.requestStart).to.be.equal(String(first(previousRequestIds)));
      expect(epoch.requestEnd).to.be.equal(String(last(previousRequestIds)));
    });

    it('Next ORE#12 should have correct request ids', async () => {
      const epoch = await rootchain.getEpoch(currentFork, NextORENumber);

      expect(epoch.isEmpty).to.be.equal(false);
      expect(epoch.requestStart).to.be.equal(String(first(requestIds)));
      expect(epoch.requestEnd).to.be.equal(String(last(requestIds)));
      expect(epoch.firstRequestBlockId).to.be.equal(String(NextORBIds[0]));
    });
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
      const epoch = await rootchain.getEpoch(currentFork, NRENumber);
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

          return rootchain.startExit(token.address, trieKey, trieValue, { from: other, value: COST_ERU });
        }));
      }

      // 8 requests
      await Promise.all(others.slice(0, 8).map(async other => {
        const trieKey = await token.getBalanceTrieKey(other);
        const trieValue = padLeft(web3.utils.numberToHex(tokenAmount));

        return rootchain.startExit(token.address, trieKey, trieValue, { from: other, value: COST_ERU });
      }));

      const EROs = await Promise.all(requestIds.map(i => rootchain.EROs(i)));

      EROs.forEach(ERO => {
        expect(ERO.isTransfer).to.be.equal(isTransfer);
        expect(ERO.finalized).to.be.equal(false);
        expect(ERO.isExit).to.be.equal(isExit);
      });
    });

    it('operator should submits NRB#14', async () => {
      await submitDummyNRBs(1);
    });

    it('operator should submits NRB#15', async () => {
      await submitDummyNRBs(1);
    });

    it('NRE#11 should have correct blocks', async () => {
      const epoch = await rootchain.getEpoch(currentFork, NRENumber);

      expect(epoch.startBlockNumber).to.be.equal(String(first(NRBNumbers)));
      expect(epoch.endBlockNumber).to.be.equal(String(last(NRBNumbers)));
    });

    it('operator should submit ORB#16', async () => {
      await submitDummyORBs(1);

      const requestBlock = await rootchain.ORBs(ORBIds[0]);
      expect(requestBlock.requestStart).to.be.bignumber.equal(String(12));
      expect(requestBlock.requestEnd).to.be.bignumber.equal(String(31));
      expect(requestBlock.submitted).to.be.equal(true);
      // expect(requestBlock.epochNumber).to.be.bignumber.equal(String(ORENumber));
    });

    it('operator should submit ORB#17', async () => {
      await submitDummyORBs(1);

      const requestBlock = await rootchain.ORBs(ORBIds[1]);
      expect(requestBlock.requestStart).to.be.bignumber.equal(String(32));
      expect(requestBlock.requestEnd).to.be.bignumber.equal(String(51));
      expect(requestBlock.submitted).to.be.equal(true);
      // expect(requestBlock.epochNumber).to.be.bignumber.equal(String(ORENumber));
    });

    it('Next request blocks should be sealed', async () => {
      const nextRequestBlock0 = await rootchain.ORBs(NextORBIds[0]);
      const nextRequestBlock1 = await rootchain.ORBs(NextORBIds[1]);

      expect(nextRequestBlock0.submitted).to.be.equal(true);
      expect(nextRequestBlock1.submitted).to.be.equal(true);
      expect(nextRequestBlock0.requestStart).to.be.bignumber.equal(String(first(requestIds)));
      expect(nextRequestBlock1.requestEnd).to.be.bignumber.equal(String(last(requestIds)));
    });

    it('ORE#12 should have correct blocks', async () => {
      const epoch = await rootchain.getEpoch(currentFork, ORENumber);

      expect(epoch.startBlockNumber).to.be.equal(String(first(ORBNumbers)));
      expect(epoch.endBlockNumber).to.be.equal(String(last(ORBNumbers)));
      expect(epoch.firstRequestBlockId).to.be.equal(String(first(ORBIds)));
    });

    it('ORE#12 should have previous requests', async () => {
      const epoch = await rootchain.getEpoch(currentFork, ORENumber);

      expect(epoch.firstRequestBlockId).to.be.equal(String(first(ORBIds)));
      expect(epoch.initialized).to.be.equal(true);
      expect(epoch.isRequest).to.be.equal(true);
      expect(epoch.isEmpty).to.be.equal(false);
      expect(epoch.requestStart).to.be.equal(String(first(previousRequestIds)));
      expect(epoch.requestEnd).to.be.equal(String(last(previousRequestIds)));
    });

    it('Next ORE#14 should have correct request ids', async () => {
      const epoch = await rootchain.getEpoch(currentFork, NextORENumber);

      expect(epoch.isEmpty).to.be.equal(false);
      expect(epoch.requestStart).to.be.equal(String(first(requestIds)));
      expect(epoch.requestEnd).to.be.equal(String(last(requestIds)));
      expect(epoch.firstRequestBlockId).to.be.equal(String(NextORBIds[0]));
    });
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
      const epoch = await rootchain.getEpoch(currentFork, NRENumber);
      expect(epoch.initialized).to.be.equal(true);
      expect(epoch.isRequest).to.be.equal(false);
      expect(epoch.isEmpty).to.be.equal(false);
    });

    it('operator should submits NRB#18', async () => {
      await submitDummyNRBs(1);
    });

    it('operator should submits NRB#19', async () => {
      await submitDummyNRBs(1);
    });

    it('NRE#13 should have correct blocks', async () => {
      const epoch = await rootchain.getEpoch(currentFork, NRENumber);

      expect(epoch.startBlockNumber).to.be.equal(String(first(NRBNumbers)));
      expect(epoch.endBlockNumber).to.be.equal(String(last(NRBNumbers)));
    });

    it('operator should submit ORB#20', async () => {
      await submitDummyORBs(1);

      const requestBlock = await rootchain.ORBs(ORBIds[0]);
      expect(requestBlock.requestStart).to.be.bignumber.equal(String(52));
      expect(requestBlock.requestEnd).to.be.bignumber.equal(String(71));
      expect(requestBlock.submitted).to.be.equal(true);
      // expect(requestBlock.epochNumber).to.be.bignumber.equal(String(ORENumber));
    });

    it('operator should submit ORB#21', async () => {
      await submitDummyORBs(1);

      const requestBlock = await rootchain.ORBs(ORBIds[1]);
      expect(requestBlock.requestStart).to.be.bignumber.equal(String(72));
      expect(requestBlock.requestEnd).to.be.bignumber.equal(String(79));
      expect(requestBlock.submitted).to.be.equal(true);
      // expect(requestBlock.epochNumber).to.be.bignumber.equal(String(ORENumber));
    });

    it('ORE#14 should have correct blocks', async () => {
      const epoch = await rootchain.getEpoch(currentFork, ORENumber);

      expect(epoch.startBlockNumber).to.be.equal(String(first(ORBNumbers)));
      expect(epoch.endBlockNumber).to.be.equal(String(last(ORBNumbers)));
      expect(epoch.firstRequestBlockId).to.be.equal(String(first(ORBIds)));
    });

    it('ORE#14 should have previous requests', async () => {
      const epoch = await rootchain.getEpoch(currentFork, ORENumber);

      expect(epoch.firstRequestBlockId).to.be.equal(String(first(ORBIds)));
      expect(epoch.initialized).to.be.equal(true);
      expect(epoch.isRequest).to.be.equal(true);
      expect(epoch.isEmpty).to.be.equal(false);
      expect(epoch.requestStart).to.be.equal(String(first(previousRequestIds)));
      expect(epoch.requestEnd).to.be.equal(String(last(previousRequestIds)));
    });

    it('Next empty ORE#16 should have correct request ids', async () => {
      const epoch = await rootchain.getEpoch(currentFork, NextORENumber);

      expect(epoch.isEmpty).to.be.equal(true);
      expect(epoch.requestStart).to.be.equal(String(first(requestIds)));
      expect(epoch.requestEnd).to.be.equal(String(last(requestIds)));
      expect(epoch.firstRequestBlockId).to.be.equal(String(NextORBId));
    });
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
      const epoch = await rootchain.getEpoch(currentFork, NRENumber);
      expect(epoch.initialized).to.be.equal(true);
      expect(epoch.isRequest).to.be.equal(false);
      expect(epoch.isEmpty).to.be.equal(false);
    });

    it('operator should submits NRB#22', async () => {
      await submitDummyNRBs(1);
    });

    it('operator should submits NRB#23', async () => {
      await submitDummyNRBs(1);
    });

    it('NRE#15 should have correct blocks', async () => {
      const epoch = await rootchain.getEpoch(currentFork, NRENumber);

      expect(epoch.startBlockNumber).to.be.equal(String(first(NRBNumbers)));
      expect(epoch.endBlockNumber).to.be.equal(String(last(NRBNumbers)));
    });

    it('ORE#16 should be empty', async () => {
      const epoch = await rootchain.getEpoch(currentFork, ORENumber);

      expect(epoch.startBlockNumber).to.be.equal(String(last(NRBNumbers)));
      expect(epoch.endBlockNumber).to.be.equal(String(last(NRBNumbers)));
      expect(epoch.firstRequestBlockId).to.be.equal(String(ORBId));
      expect(epoch.initialized).to.be.equal(true);
      expect(epoch.isRequest).to.be.equal(true);
      expect(epoch.isEmpty).to.be.equal(true);
      expect(epoch.requestStart).to.be.equal(String(first(previousRequestIds)));
      expect(epoch.requestEnd).to.be.equal(String(last(previousRequestIds)));
    });

    it('Next empty ORE#18 should have correct request ids', async () => {
      const epoch = await rootchain.getEpoch(currentFork, NextORENumber);

      expect(epoch.isEmpty).to.be.equal(true);
      expect(epoch.requestStart).to.be.equal(String(first(requestIds)));
      expect(epoch.requestEnd).to.be.equal(String(last(requestIds)));
      expect(epoch.firstRequestBlockId).to.be.equal(String(NextORBId));
    });
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
      const epoch = await rootchain.getEpoch(currentFork, NRENumber);
      expect(epoch.initialized).to.be.equal(true);
      expect(epoch.isRequest).to.be.equal(false);
      expect(epoch.isEmpty).to.be.equal(false);
    });

    it('operator should submits NRB#24', async () => {
      await submitDummyNRBs(1);
    });

    it('operator should submits NRB#25', async () => {
      await submitDummyNRBs(1);
    });

    it('NRE#17 should have correct blocks', async () => {
      const epoch = await rootchain.getEpoch(currentFork, NRENumber);

      expect(epoch.startBlockNumber).to.be.equal(String(first(NRBNumbers)));
      expect(epoch.endBlockNumber).to.be.equal(String(last(NRBNumbers)));
    });

    it('ORE#18 should be empty', async () => {
      const epoch = await rootchain.getEpoch(currentFork, ORENumber);

      expect(epoch.startBlockNumber).to.be.equal(String(last(NRBNumbers)));
      expect(epoch.endBlockNumber).to.be.equal(String(last(NRBNumbers)));
      expect(epoch.firstRequestBlockId).to.be.equal(String(ORBId));
      expect(epoch.initialized).to.be.equal(true);
      expect(epoch.isRequest).to.be.equal(true);
      expect(epoch.isEmpty).to.be.equal(true);
      expect(epoch.requestStart).to.be.equal(String(first(previousRequestIds)));
      expect(epoch.requestEnd).to.be.equal(String(last(previousRequestIds)));
    });

    it('Next empty ORE#20 should have correct request ids', async () => {
      const epoch = await rootchain.getEpoch(currentFork, NextORENumber);

      expect(epoch.isEmpty).to.be.equal(true);
      expect(epoch.requestStart).to.be.equal(String(first(requestIds)));
      expect(epoch.requestEnd).to.be.equal(String(last(requestIds)));
      expect(epoch.firstRequestBlockId).to.be.equal(String(NextORBId));
    });
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
      expect((await rootchain.lastEpoch(0))).to.be.bignumber.equal(String(NRENumber - 1));

      const epoch = await rootchain.getEpoch(currentFork, NRENumber);
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

          return rootchain.startExit(token.address, trieKey, trieValue, { from: other, value: COST_ERU });
        }));
      }

      const EROs = await Promise.all(requestIds.map(i => rootchain.EROs(i)));

      EROs.forEach(ERO => {
        expect(ERO.isTransfer).to.be.equal(isTransfer);
        expect(ERO.finalized).to.be.equal(false);
        expect(ERO.isExit).to.be.equal(isExit);
      });
    });

    it('operator should submits NRB#26', async () => {
      await submitDummyNRBs(1);
    });

    it('operator should submits NRB#27', async () => {
      await submitDummyNRBs(1);
    });

    it('NRE#19 should have correct blocks', async () => {
      const epoch = await rootchain.getEpoch(currentFork, NRENumber);

      expect(epoch.startBlockNumber).to.be.equal(String(first(NRBNumbers)));
      expect(epoch.endBlockNumber).to.be.equal(String(last(NRBNumbers)));
    });

    it('ORE#20 should be empty', async () => {
      const epoch = await rootchain.getEpoch(currentFork, ORENumber);

      expect(epoch.startBlockNumber).to.be.equal(String(last(NRBNumbers)));
      expect(epoch.endBlockNumber).to.be.equal(String(last(NRBNumbers)));
      expect(epoch.firstRequestBlockId).to.be.equal(String(ORBId));
      expect(epoch.initialized).to.be.equal(true);
      expect(epoch.isRequest).to.be.equal(true);
      expect(epoch.isEmpty).to.be.equal(true);
      expect(epoch.requestStart).to.be.equal(String(first(previousRequestIds)));
      expect(epoch.requestEnd).to.be.equal(String(last(previousRequestIds)));
    });

    it('Next request blocks should be sealed', async () => {
      const nextRequestBlock0 = await rootchain.ORBs(NextORBIds[0]);
      const nextRequestBlock1 = await rootchain.ORBs(NextORBIds[1]);

      expect(nextRequestBlock0.submitted).to.be.equal(true);
      expect(nextRequestBlock1.submitted).to.be.equal(true);
      expect(nextRequestBlock0.requestStart).to.be.bignumber.equal(String(first(requestIds)));
      expect(nextRequestBlock1.requestEnd).to.be.bignumber.equal(String(last(requestIds)));
    });

    it('Next empty ORE#22 should have correct request ids', async () => {
      const epoch = await rootchain.getEpoch(currentFork, NextORENumber);

      expect(epoch.isEmpty).to.be.equal(false);
      expect(epoch.requestStart).to.be.equal(String(first(requestIds)));
      expect(epoch.requestEnd).to.be.equal(String(last(requestIds)));
      expect(epoch.firstRequestBlockId).to.be.equal(String(first(NextORBIds)));
    });
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
      const epoch = await rootchain.getEpoch(currentFork, NRENumber);
      expect(epoch.initialized).to.be.equal(true);
      expect(epoch.isRequest).to.be.equal(false);
      expect(epoch.isEmpty).to.be.equal(false);
    });

    it('operator should submits NRB#28', async () => {
      await submitDummyNRBs(1);
    });

    it('operator should submits NRB#29', async () => {
      await submitDummyNRBs(1);
    });

    it('NRE#21 should have correct blocks', async () => {
      const epoch = await rootchain.getEpoch(currentFork, NRENumber);

      expect(epoch.startBlockNumber).to.be.equal(String(first(NRBNumbers)));
      expect(epoch.endBlockNumber).to.be.equal(String(last(NRBNumbers)));
    });

    it('operator should submit ORB#30', async () => {
      await submitDummyORBs(1);

      const requestBlock = await rootchain.ORBs(ORBIds[0]);
      expect(requestBlock.requestStart).to.be.bignumber.equal(String(80));
      expect(requestBlock.requestEnd).to.be.bignumber.equal(String(99));
      expect(requestBlock.submitted).to.be.equal(true);
      // expect(requestBlock.epochNumber).to.be.bignumber.equal(String(ORENumber));
    });

    it('operator should submit ORB#31', async () => {
      await submitDummyORBs(1);

      const requestBlock = await rootchain.ORBs(ORBIds[1]);
      expect(requestBlock.requestStart).to.be.bignumber.equal(String(100));
      expect(requestBlock.requestEnd).to.be.bignumber.equal(String(119));
      expect(requestBlock.submitted).to.be.equal(true);
      // expect(requestBlock.epochNumber).to.be.bignumber.equal(String(ORENumber));
    });

    it('ORE#22 should have correct blocks', async () => {
      const epoch = await rootchain.getEpoch(currentFork, ORENumber);

      expect(epoch.startBlockNumber).to.be.equal(String(first(ORBNumbers)));
      expect(epoch.endBlockNumber).to.be.equal(String(last(ORBNumbers)));
      expect(epoch.firstRequestBlockId).to.be.equal(String(first(ORBIds)));
    });

    it('ORE#22 should have previous requests', async () => {
      const epoch = await rootchain.getEpoch(currentFork, ORENumber);

      expect(epoch.firstRequestBlockId).to.be.equal(String(first(ORBIds)));
      expect(epoch.initialized).to.be.equal(true);
      expect(epoch.isRequest).to.be.equal(true);
      expect(epoch.isEmpty).to.be.equal(false);
      expect(epoch.requestStart).to.be.equal(String(first(previousRequestIds)));
      expect(epoch.requestEnd).to.be.equal(String(last(previousRequestIds)));
    });

    it('Next empty ORE#24 should have correct request ids', async () => {
      const epoch = await rootchain.getEpoch(currentFork, NextORENumber);

      expect(epoch.isEmpty).to.be.equal(true);
      expect(epoch.requestStart).to.be.equal(String(first(requestIds)));
      expect(epoch.requestEnd).to.be.equal(String(last(requestIds)));
      expect(epoch.firstRequestBlockId).to.be.equal(String(NextORBId));
    });
  });

  describe('finalization', async () => {
    it('block should be fianlzied', finalizeBlocks);
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
