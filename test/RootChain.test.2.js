const { range, last, first } = require('lodash');
const expectEvent = require('openzeppelin-solidity/test/helpers/expectEvent');
const { increaseTime, increaseTimeTo } = require('openzeppelin-solidity/test/helpers/increaseTime');
const { latestTime } = require('openzeppelin-solidity/test/helpers/latestTime');
const { EVMRevert } = require('openzeppelin-solidity/test/helpers/EVMRevert');

const { padLeft } = require('./helpers/pad');
const { appendHex } = require('./helpers/appendHex');
const Data = require('./lib/Data');

const RootChain = artifacts.require('RootChain.sol');
const RequestableSimpleToken = artifacts.require('RequestableSimpleToken.sol');

require('chai')
  .use(require('chai-as-promised'))
  .use(require('chai-bignumber')(web3.BigNumber))
  .should();

const BigNumber = web3.BigNumber;
const LOGTX = process.env.LOGTX || false;
const VERBOSE = process.env.VERBOSE || false;

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
    const firstEpoch = new Data.PlasmaBlock(
      await rootchain.getBlock(currentFork, firstBlock)
    ).epochNumber.toNumber();

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
    token = await RequestableSimpleToken.new();

    await Promise.all(others.map(other => token.mint(other, tokenAmount.mul(100))));
    await rootchain.mapRequestableContractByOperator(token.address, tokenInChildChain);
    (await rootchain.requestableContracts(token.address)).should.be.equal(tokenInChildChain);

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

    if (VERBOSE) {
      for (const eventName of targetEvents) {
        const event = rootchain[eventName]({});
        event.watch((err, e) => {
          if (!err) {
            log(`[${eventName}]: ${JSON.stringify(e.args)}`);
            if (typeof eventHandlers[eventName] === 'function') {
              eventHandlers[eventName](e);
            }
          } else {
            console.error(`[${eventName}]`, err);
          }
        });
      }
    }
  });

  async function checkLastBlockNumber () {
    (await rootchain.lastBlock(currentFork))
      .should.be.bignumber.equal(forks[currentFork].lastBlock);
  }

  async function submitDummyNRBs (numBlocks) {
    for (const _ of range(numBlocks)) {
      await checkLastBlockNumber();

      const tx = await rootchain.submitNRB(currentFork, statesRoot, transactionsRoot, receiptsRoot, { value: COST_NRB });
      logtx(tx);
      forks[currentFork].lastBlock += 1;

      await checkLastBlockNumber();
    }
  }

  async function submitDummyORBs (numBlocks) {
    for (const _ of range(numBlocks)) {
      await checkLastBlockNumber();

      const tx = await rootchain.submitORB(currentFork, statesRoot, transactionsRoot, receiptsRoot, { value: COST_ORB });
      logtx(tx);
      forks[currentFork].lastBlock += 1;

      await checkLastBlockNumber();
    }
  }

  async function finalizeBlocks () {
    // finalize blocks until all blocks are fianlized
    const lastFinalizedBlockNumber = await rootchain.getLastFinalizedBlock(currentFork);
    const blockNumberToFinalize = lastFinalizedBlockNumber.add(1);
    const block = new Data.PlasmaBlock(await rootchain.getBlock(currentFork, blockNumberToFinalize));

    // short circuit if all blocks are finalized
    if (lastFinalizedBlockNumber.gte(forks[currentFork].lastBlock)) {
      return;
    }

    const finalizedAt = block.timestamp.add(CP_WITHHOLDING + 1);

    log(`
      currentFork: ${currentFork}
      lastFinalizedBlockNumber: ${lastFinalizedBlockNumber}
      finalizedAt: ${finalizedAt}
      block.timestamp: ${block.timestamp}
      block: ${JSON.stringify(block)}
      await latestTime(): ${await latestTime()}
    `);

    if (await latestTime() < finalizedAt) {
      await increaseTimeTo(finalizedAt);
    }
    await rootchain.finalizeBlock();

    forks[currentFork].lastFinalizedBlock = (await rootchain.getLastFinalizedBlock(currentFork)).toNumber();

    return finalizeBlocks();
  }

  async function logEpoch (forkNumber, epochNumber) {
    if (epochNumber < 0) return;

    const epoch = new Data.Epoch(await rootchain.getEpoch(forkNumber, epochNumber));
    log(`      Epoch#${forkNumber}.${epochNumber} ${JSON.stringify(epoch)}`);
  }

  async function logBlock (forkNumber, blockNumber) {
    const block = new Data.PlasmaBlock(await rootchain.getBlock(forkNumber, blockNumber));
    log(`      Block#${forkNumber}.${blockNumber} ${JSON.stringify(block)}`);
  }

  async function logEpochAndBlock (forkNumber, epochNumber) {
    const epoch = new Data.Epoch(await rootchain.getEpoch(forkNumber, epochNumber));
    log(`
      Epoch#${forkNumber}.${epochNumber} ${JSON.stringify(epoch)}
      ORBs.length: ${await rootchain.getNumORBs()}
      `);

    for (const i of range(
      epoch.startBlockNumber.toNumber(),
      epoch.endBlockNumber.toNumber() + 1
    )) {
      log(`
        Block#${i} ${JSON.stringify(new Data.PlasmaBlock(await rootchain.getBlock(forkNumber, i)))}`);
    }
  }

  describe('NRE#1 - ORE#2 (ETH Deposit)', async () => {
    const NRENumber = 1;
    const ORENumber = 2;

    const ORBId = 0;
    const requestIds = range(0, 4);

    before('check NRE', async () => {
      const epoch = new Data.Epoch(await rootchain.getEpoch(currentFork, NRENumber));
      epoch.initialized.should.be.equal(true);
      epoch.isRequest.should.be.equal(false);
      epoch.isEmpty.should.be.equal(false);
    });

    it('operator should submits NRB#1', async () => {
      await submitDummyNRBs(1);
    });

    it('user can make an enter request for ETH deposit (requests: [0, 4))', async () => {
      const isTransfer = true;

      await Promise.all(users.map(async other => {
        const tx = await rootchain.startEnter(isTransfer, other, emptyBytes32, emptyBytes32, {
          from: other,
          value: etherAmount,
        });

        logtx(tx);
      }));

      await Promise.all(requestIds.map(async (requestId) => {
        const ERO = new Data.Request(await rootchain.EROs(requestId));

        ERO.isTransfer.should.be.equal(isTransfer);
        ERO.value.should.be.bignumber.equal(etherAmount);
        ERO.finalized.should.be.equal(false);
        ERO.isExit.should.be.equal(false);
      }));
    });

    it('operator should submits NRB#2', async () => {
      await submitDummyNRBs(1);
    });

    it('operator should submit ORB#3', async () => {
      await submitDummyORBs(1);

      const requestBlock = new Data.RequestBlock(await rootchain.ORBs(ORBId));
      requestBlock.requestStart.should.be.bignumber.equal(first(requestIds));
      requestBlock.requestEnd.should.be.bignumber.equal(last(requestIds));
      requestBlock.submitted.should.be.equal(true);
      // requestBlock.epochNumber.should.be.bignumber.equal(ORENumber);
    });

    after('check ORE', async () => {
      const epoch = new Data.Epoch(await rootchain.getEpoch(currentFork, ORENumber));

      epoch.firstRequestBlockId.should.be.bignumber.equal(ORBId);
      epoch.initialized.should.be.equal(true);
      epoch.isRequest.should.be.equal(true);
      epoch.isEmpty.should.be.equal(false);
      epoch.requestStart.should.be.bignumber.equal(first(requestIds));
      epoch.requestEnd.should.be.bignumber.equal(last(requestIds));
    });
  });

  describe('NRE#3 - ORE#4 (Token Deposit)', async () => {
    const NRENumber = 3;
    const ORENumber = 4;

    const ORBId = 1;
    const requestIds = range(4, 8);

    before('check NRE', async () => {
      const epoch = new Data.Epoch(await rootchain.getEpoch(currentFork, NRENumber));
      epoch.initialized.should.be.equal(true);
      epoch.isRequest.should.be.equal(false);
      epoch.isEmpty.should.be.equal(false);
    });

    it('operator should submits NRB#4', async () => {
      await submitDummyNRBs(1);
    });

    it('user can make an enter request for Token deposit (requests: [4, 8))', async () => {
      const isTransfer = false;

      await Promise.all(users.map(async other => {
        const trieKey = calcTrieKey(other);
        const trieValue = padLeft(web3.fromDecimal(tokenAmount));

        const tokenBalance = await token.balances(other);

        const tx = await rootchain.startEnter(isTransfer, token.address, trieKey, trieValue, { from: other });
        logtx(tx);

        (await token.balances(other)).should.be.bignumber.equal(tokenBalance.sub(tokenAmount));
      }));

      await Promise.all(requestIds.map(async (requestId) => {
        const ERO = new Data.Request(await rootchain.EROs(requestId));

        ERO.isTransfer.should.be.equal(isTransfer);
        ERO.finalized.should.be.equal(false);
        ERO.isExit.should.be.equal(false);
      }));
    });

    it('operator should submits NRB#5', async () => {
      await submitDummyNRBs(1);
    });

    it('operator should submit ORB#6', async () => {
      await submitDummyORBs(1);

      const requestBlock = new Data.RequestBlock(await rootchain.ORBs(ORBId));
      requestBlock.requestStart.should.be.bignumber.equal(first(requestIds));
      requestBlock.requestEnd.should.be.bignumber.equal(last(requestIds));
      requestBlock.submitted.should.be.equal(true);
      // requestBlock.epochNumber.should.be.bignumber.equal(ORENumber);
    });

    after('check ORE', async () => {
      const epoch = new Data.Epoch(await rootchain.getEpoch(currentFork, ORENumber));

      epoch.firstRequestBlockId.should.be.bignumber.equal(ORBId);
      epoch.initialized.should.be.equal(true);
      epoch.isRequest.should.be.equal(true);
      epoch.isEmpty.should.be.equal(false);
      epoch.requestStart.should.be.bignumber.equal(first(requestIds));
      epoch.requestEnd.should.be.bignumber.equal(last(requestIds));
    });
  });

  describe('NRE#5 - ORE#6 (empty)', async () => {
    const NRENumber = 5;
    const ORENumber = 6;

    before('check NRE', async () => {
      const epoch = new Data.Epoch(await rootchain.getEpoch(currentFork, NRENumber));
      epoch.initialized.should.be.equal(true);
      epoch.isRequest.should.be.equal(false);
      epoch.isEmpty.should.be.equal(false);
    });

    it('operator should submits NRB#7', async () => {
      await submitDummyNRBs(1);
    });

    it('operator should submits NRB#8', async () => {
      await submitDummyNRBs(1);
    });

    after('check ORE', async () => {
      const previousORE = new Data.Epoch(await rootchain.getEpoch(currentFork, ORENumber - 2));
      const epoch = new Data.Epoch(await rootchain.getEpoch(currentFork, ORENumber));

      epoch.firstRequestBlockId.should.be.bignumber.equal(previousORE.firstRequestBlockId);
      epoch.initialized.should.be.equal(true);
      epoch.isRequest.should.be.equal(true);
      epoch.isEmpty.should.be.equal(true);
      epoch.requestStart.should.be.bignumber.equal(previousORE.requestEnd);
      epoch.requestEnd.should.be.bignumber.equal(previousORE.requestEnd);
    });
  });

  describe('NRE#7 - ORE#8 (token withdrawal)', async () => {
    const NRENumber = 7;
    const ORENumber = 8;

    const ORBId = 2;
    const requestIds = range(8, 12);

    before('check NRE', async () => {
      const epoch = new Data.Epoch(await rootchain.getEpoch(currentFork, NRENumber));
      epoch.initialized.should.be.equal(true);
      epoch.isRequest.should.be.equal(false);
      epoch.isEmpty.should.be.equal(false);
    });

    it('user can make an exit request for token withdrawal (requests: [8, 12))', async () => {
      const isTransfer = false;
      const isExit = true;

      await Promise.all(users.map(async other => {
        const trieKey = calcTrieKey(other);
        const trieValue = padLeft(web3.fromDecimal(tokenAmount));

        const tx = await rootchain.startExit(token.address, trieKey, trieValue, { from: other, value: COST_ERU });
        logtx(tx);
      }));

      await Promise.all(requestIds.map(async (requestId) => {
        const ERO = new Data.Request(await rootchain.EROs(requestId));

        ERO.isTransfer.should.be.equal(isTransfer);
        ERO.finalized.should.be.equal(false);
        ERO.isExit.should.be.equal(isExit);
      }));
    });

    it('operator should submits NRB#9', async () => {
      await submitDummyNRBs(1);
    });

    it('operator should submits NRB#10', async () => {
      await submitDummyNRBs(1);
    });

    it('operator should submit ORB#11', async () => {
      await submitDummyORBs(1);

      const requestBlock = new Data.RequestBlock(await rootchain.ORBs(ORBId));
      requestBlock.requestStart.should.be.bignumber.equal(first(requestIds));
      requestBlock.requestEnd.should.be.bignumber.equal(last(requestIds));
      requestBlock.submitted.should.be.equal(true);
      // requestBlock.epochNumber.should.be.bignumber.equal(ORENumber);
    });

    after('check ORE', async () => {
      const epoch = new Data.Epoch(await rootchain.getEpoch(currentFork, ORENumber));

      epoch.firstRequestBlockId.should.be.bignumber.equal(ORBId);
      epoch.initialized.should.be.equal(true);
      epoch.isRequest.should.be.equal(true);
      epoch.isEmpty.should.be.equal(false);
      epoch.requestStart.should.be.bignumber.equal(first(requestIds));
      epoch.requestEnd.should.be.bignumber.equal(last(requestIds));
    });
  });

  describe('NRE#9 - ORE#10 (bulk request)', async () => {
    const NRENumber = 9;
    const ORENumber = 10;

    const ORBIds = [3, 4];
    const requestIds = range(12, 52);

    before('check NRE', async () => {
      const epoch = new Data.Epoch(await rootchain.getEpoch(currentFork, NRENumber));
      epoch.initialized.should.be.equal(true);
      epoch.isRequest.should.be.equal(false);
      epoch.isEmpty.should.be.equal(false);
    });

    it('user can make an exit request for token withdrawal (requests: [12, 52))', async () => {
      const isTransfer = false;
      const isExit = true;

      for (const i of range(requestIds.length / others.length)) {
        await Promise.all(others.map(async other => {
          const trieKey = calcTrieKey(other);
          const trieValue = padLeft(web3.fromDecimal(tokenAmount));

          return rootchain.startExit(token.address, trieKey, trieValue, { from: other, value: COST_ERU });
        }));
      }

      const EROs = (await Promise.all(requestIds.map(i => rootchain.EROs(i))))
        .map(r => new Data.Request(r));

      EROs.forEach(ERO => {
        ERO.isTransfer.should.be.equal(isTransfer);
        ERO.finalized.should.be.equal(false);
        ERO.isExit.should.be.equal(isExit);
      });
    });

    it('operator should submits NRB#12', async () => {
      await submitDummyNRBs(1);
    });

    it('operator should submits NRB#13', async () => {
      await submitDummyNRBs(1);
    });

    it('operator should submit ORB#14', async () => {
      await submitDummyORBs(1);

      const requestBlock = new Data.RequestBlock(await rootchain.ORBs(ORBIds[0]));
      requestBlock.requestStart.should.be.bignumber.equal(12);
      requestBlock.requestEnd.should.be.bignumber.equal(31);
      requestBlock.submitted.should.be.equal(true);
      // requestBlock.epochNumber.should.be.bignumber.equal(ORENumber);
    });

    it('operator should submit ORB#15', async () => {
      await submitDummyORBs(1);

      const requestBlock = new Data.RequestBlock(await rootchain.ORBs(ORBIds[1]));
      requestBlock.requestStart.should.be.bignumber.equal(32);
      requestBlock.requestEnd.should.be.bignumber.equal(51);
      requestBlock.submitted.should.be.equal(true);
      // requestBlock.epochNumber.should.be.bignumber.equal(ORENumber);
    });

    after('check ORE', async () => {
      const epoch = new Data.Epoch(await rootchain.getEpoch(currentFork, ORENumber));

      epoch.firstRequestBlockId.should.be.bignumber.equal(ORBIds[0]);
      epoch.startBlockNumber.should.be.bignumber.equal(14);
      epoch.endBlockNumber.should.be.bignumber.equal(15);
      epoch.initialized.should.be.equal(true);
      epoch.isRequest.should.be.equal(true);
      epoch.isEmpty.should.be.equal(false);
      epoch.requestStart.should.be.bignumber.equal(first(requestIds));
      epoch.requestEnd.should.be.bignumber.equal(last(requestIds));
    });
  });

  describe('NRE#11 - ORE#12 (bulk request)', async () => {
    const NRENumber = 11;
    const ORENumber = 12;

    const ORBIds = [5, 6];
    const requestIds = range(52, 80);

    before('check NRE', async () => {
      const epoch = new Data.Epoch(await rootchain.getEpoch(currentFork, NRENumber));
      epoch.initialized.should.be.equal(true);
      epoch.isRequest.should.be.equal(false);
      epoch.isEmpty.should.be.equal(false);
    });

    it('user can make an exit request for token withdrawal (requests: [52, 80))', async () => {
      const isTransfer = false;
      const isExit = true;

      // 20 requests
      for (const _ of range(2)) {
        await Promise.all(others.map(async other => {
          const trieKey = calcTrieKey(other);
          const trieValue = padLeft(web3.fromDecimal(tokenAmount));

          return rootchain.startExit(token.address, trieKey, trieValue, { from: other, value: COST_ERU });
        }));
      }

      // 8 requests
      await Promise.all(others.slice(0, 8).map(async other => {
        const trieKey = calcTrieKey(other);
        const trieValue = padLeft(web3.fromDecimal(tokenAmount));

        return rootchain.startExit(token.address, trieKey, trieValue, { from: other, value: COST_ERU });
      }));

      const EROs = (await Promise.all(requestIds.map(i => rootchain.EROs(i))))
        .map(r => new Data.Request(r));

      EROs.forEach(ERO => {
        ERO.isTransfer.should.be.equal(isTransfer);
        ERO.finalized.should.be.equal(false);
        ERO.isExit.should.be.equal(isExit);
      });
    });

    it('operator should submits NRB#16', async () => {
      await submitDummyNRBs(1);
    });

    it('operator should submits NRB#17', async () => {
      await submitDummyNRBs(1);
    });

    it('operator should submit ORB#18', async () => {
      await submitDummyORBs(1);

      const requestBlock = new Data.RequestBlock(await rootchain.ORBs(ORBIds[0]));
      requestBlock.requestStart.should.be.bignumber.equal(52);
      requestBlock.requestEnd.should.be.bignumber.equal(71);
      requestBlock.submitted.should.be.equal(true);
      // requestBlock.epochNumber.should.be.bignumber.equal(ORENumber);
    });

    it('operator should submit ORB#19', async () => {
      await submitDummyORBs(1);

      const requestBlock = new Data.RequestBlock(await rootchain.ORBs(ORBIds[1]));
      requestBlock.requestStart.should.be.bignumber.equal(72);
      requestBlock.requestEnd.should.be.bignumber.equal(79);
      requestBlock.submitted.should.be.equal(true);
      // requestBlock.epochNumber.should.be.bignumber.equal(ORENumber);
    });

    after('check ORE', async () => {
      const epoch = new Data.Epoch(await rootchain.getEpoch(currentFork, ORENumber));

      epoch.firstRequestBlockId.should.be.bignumber.equal(ORBIds[0]);
      epoch.startBlockNumber.should.be.bignumber.equal(18);
      epoch.endBlockNumber.should.be.bignumber.equal(19);
      epoch.initialized.should.be.equal(true);
      epoch.isRequest.should.be.equal(true);
      epoch.isEmpty.should.be.equal(false);
      epoch.requestStart.should.be.bignumber.equal(first(requestIds));
      epoch.requestEnd.should.be.bignumber.equal(last(requestIds));
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

function calcTrieKey (addr) {
  return web3.sha3(appendHex(padLeft(addr), padLeft('0x02')), { encoding: 'hex' });
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
