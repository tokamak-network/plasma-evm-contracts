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
  others = others.slice(0, 4);
  const submiter = others[0]; // URB submiter

  // rootchain parameters
  let MAX_REQUESTS;
  let NRELength; // === 2
  let COST_ERO, COST_ERU, COST_URB_PREPARE, COST_URB, COST_ORB, COST_NRB;
  let CP_COMPUTATION, CP_WITHHOLDING, CP_EXIT;

  // test variables
  let currentFork = 0;

  let numEROs = 0;
  let numERUs = 0;

  let EROToApply = 0;
  let ERUToApply = 0;

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
  });

  // Chain is fored after a URB is submitted.
  async function checkFork () {
    await timeout(1);
    const previousFork = currentFork - 1;

    const preFork = new Data.Fork(await rootchain.forks(previousFork));
    const curFork = new Data.Fork(await rootchain.forks(currentFork));

    preFork.forkedBlock.should.be.bignumber.equal(curFork.firstBlock);

    const lastFinalizedBlock = new Data.PlasmaBlock(
      await rootchain.getBlock(previousFork, curFork.firstBlock.sub(1))
    );

    lastFinalizedBlock.finalized.should.be.equal(true);

    const nextBlock = new Data.PlasmaBlock(
      await rootchain.getBlock(previousFork, curFork.firstBlock)
    );

    (nextBlock.timestamp.toNumber() === 0 || !nextBlock.finalized)
      .should.be.equal(true);

    const firstURB = new Data.PlasmaBlock(
      await rootchain.getBlock(currentFork, curFork.firstBlock)
    );

    const URE = new Data.Epoch(
      await rootchain.getEpoch(currentFork, firstURB.epochNumber)
    );

    URE.isEmpty.should.be.equal(false);
    URE.isRequest.should.be.equal(true);
    URE.userActivated.should.be.equal(true);
  }

  // check ORE, NRE, URE, ORE' and NRE'.
  async function checkEpoch (epochNumber) {
    const fork = new Data.Fork(await rootchain.forks(currentFork));
    const epoch = new Data.Epoch(await rootchain.getEpoch(currentFork, epochNumber));
    const numBlocks = epoch.requestEnd.sub(epoch.requestStart).add(1).div(MAX_REQUESTS).ceil();

    // TODO: check block is included in the epoch

    log(`
    checking Epoch#${currentFork}#${epochNumber}`);

    // check # of blocks
    if (epoch.isRequest && !epoch.rebase) {
      log(`epoch1: ${JSON.stringify(epoch)}`);
      const expectedNumBlocks = epoch.endBlockNumber.sub(epoch.startBlockNumber).add(1);
      expectedNumBlocks.should.be.bignumber.equal(numBlocks);
    }

    if (epochNumber === 1) { // first NRB epoch
      epoch.startBlockNumber.should.be.bignumber.equal(1);
      epoch.endBlockNumber.should.be.bignumber.equal(NRELength);
      epoch.isRequest.should.be.equal(false);
      epoch.isEmpty.should.be.equal(false);
    } else if (epochNumber === 2) { // second ORB epoch
      if (epoch.isEmpty) {
        epoch.startBlockNumber.should.be.bignumber.equal(NRELength);
        epoch.endBlockNumber.should.be.bignumber.equal(epoch.startBlockNumber);
      } else {
        epoch.startBlockNumber.should.be.bignumber.equal(NRELength.add(1));
      }
      epoch.isRequest.should.be.equal(true);
    } else if (epochNumber > 2 && epoch.isRequest && epoch.userActivated) {
      // TODO: check URE

    } else if (epochNumber > 2 && epoch.isRequest) { // later request epochs
      if (!epoch.rebase) {
        // check ORE

        // previous non request epoch
        const previousNRE = new Data.Epoch(await rootchain.getEpoch(currentFork, epochNumber - 1));

        // previous request epoch
        const previousORENumber = currentFork !== 0 && fork.firstEpoch.add(4).eq(epochNumber)
          ? epochNumber - 3 : epochNumber - 2;
        const previousORE = new Data.Epoch(await rootchain.getEpoch(currentFork, previousORENumber));
        const numPreviousORBs = previousORE.endBlockNumber.sub(previousORE.startBlockNumber).add(1);

        const firstRequestBlockNumber = await rootchain.firstFilledORENumber(currentFork);

        log(`
        Epoch?
         - last: ${epochNumber}
         - previous requeast epoch: ${previousORENumber}
         - firstRequestBlockNumber: ${firstRequestBlockNumber}
        `);

        previousORE.isRequest.should.be.equal(true);

        if (epoch.isEmpty) {
          epoch.startBlockNumber.should.be.bignumber.equal(previousNRE.endBlockNumber);
          epoch.endBlockNumber.should.be.bignumber.equal(epoch.startBlockNumber);

          epoch.requestStart.should.be.bignumber.equal(previousORE.requestEnd);
          epoch.requestStart.should.be.bignumber.equal(epoch.requestEnd);

          epoch.firstRequestBlockId.should.be.bignumber.equal(previousORE.firstRequestBlockId);
        } else {
          epoch.startBlockNumber.should.be.bignumber.equal(previousNRE.endBlockNumber.add(1));
          epoch.requestEnd.should.be.bignumber.gt(epoch.requestStart);

          if (currentFork === 0 && firstRequestBlockNumber.cmp(epochNumber) === 0) {
            // first ORE
            epoch.requestStart.should.be.bignumber.equal(0);
            epoch.firstRequestBlockId.should.be.bignumber.equal(0);
          } else if (firstRequestBlockNumber.cmp(epochNumber) === 0) {
            epoch.requestStart.should.be.bignumber.equal(previousORE.requestEnd.add(1));
            epoch.firstRequestBlockId.should.be.bignumber.equal(previousORE.firstRequestBlockId.add(numPreviousORBs));
          } else {
            epoch.requestStart.should.be.bignumber.equal(previousORE.requestEnd.add(1));
            epoch.firstRequestBlockId.should.be.bignumber.equal(previousORE.firstRequestBlockId.add(numPreviousORBs));
          }
        }
      } else {
        // check ORE'

        // previous URE
        const previousURE = new Data.Epoch(await rootchain.getEpoch(currentFork, epochNumber - 1));
        previousURE.userActivated.should.be.equal(true);
        previousURE.isRequest.should.be.equal(true);

        if (!epoch.endBlockNumber.eq(0) && !epoch.isEmpty) {
          const numBlocks = epoch.endBlockNumber.sub(epoch.startBlockNumber).add(1);
          numBlocks.should.be.bignumber.gt(0);
        }
      }
    } else if (epochNumber > 2 && !epoch.isRequest) { // later non request epochs
      // check NRE
      if (!epoch.rebase) {
        // previous request epoch
        const previousORE = new Data.Epoch(await rootchain.getEpoch(currentFork, epochNumber - 1));

        epoch.startBlockNumber.should.be.bignumber.equal(previousORE.endBlockNumber.add(1));
        epoch.endBlockNumber.sub(epoch.startBlockNumber).add(1).should.be.bignumber.equal(NRELength);

        epoch.isRequest.should.be.equal(false);
        epoch.isEmpty.should.be.equal(false);
      } else {
        // check NRE'

        // previous NRE'
        const previousNREAfterFork = new Data.Epoch(await rootchain.getEpoch(currentFork, epochNumber - 1));
        previousNREAfterFork.userActivated.should.be.equal(false);
        previousNREAfterFork.isRequest.should.be.equal(true);

        // TODO: check num blocks in NRE'
        if (!epoch.endBlockNumber.eq(0) && !epoch.isEmpty) {
          const numBlocks = epoch.endBlockNumber.sub(epoch.startBlockNumber).add(1);
          numBlocks.should.be.bignumber.gt(0);
        }

        // // check fork
        // const fork = new Data.Fork(await rootchain.forks(currentFork));
        // fork.rebased.should.be.equal(true);
      }
    }
  }

  async function checkRequestBlock (blockNumber) {
    const forkNumber = currentFork;
    const fork = forks[forkNumber];

    const block = new Data.PlasmaBlock(await rootchain.getBlock(forkNumber, blockNumber));
    const epoch = new Data.Epoch(await rootchain.getEpoch(forkNumber, block.epochNumber));
    const requestBlock = new Data.RequestBlock(await rootchain.ORBs(block.requestBlockId));

    let perviousEpochNumber = block.epochNumber.sub(2);
    let perviousEpoch = new Data.Epoch(await rootchain.getEpoch(forkNumber, perviousEpochNumber));

    // in case of first ORE after forked (not ORE')
    if (forkNumber !== 0 && block.epochNumber.cmp(fork.firstEpoch + 4) === 0) {
      perviousEpochNumber = block.epochNumber.sub(3);
      perviousEpoch = new Data.Epoch(await rootchain.getEpoch(forkNumber, perviousEpochNumber));
    }

    if (!epoch.rebase) {
      await logEpoch(forkNumber, perviousEpochNumber);
    }

    await logEpoch(forkNumber, block.epochNumber);
    await logBlock(forkNumber, blockNumber);
    log(`      RequestBlock#${block.requestBlockId} ${JSON.stringify(requestBlock)}`);

    block.isRequest.should.be.equal(true);
    epoch.isRequest.should.be.equal(true);
    epoch.isEmpty.should.be.equal(false);

    // check epochs
    if (!epoch.rebase) {
      // check ORE
      perviousEpoch.initialized.should.be.equal(true);
      perviousEpoch.isRequest.should.be.equal(true);

      if (perviousEpoch.isEmpty) {
        if (perviousEpoch.rebase) {
          epoch.firstRequestBlockId.should.be.bignumber.equal(perviousEpoch.firstRequestBlockId.add(1));
        } else {
          epoch.firstRequestBlockId.should.be.bignumber.equal(perviousEpoch.firstRequestBlockId);
        }
      } else if (perviousEpoch.initialized) {
        // previous request epoch is not empty
        const numPreviousBlocks = perviousEpoch.endBlockNumber.sub(perviousEpoch.startBlockNumber).add(1);
        const expectedFirstRequestBlockId = perviousEpoch.firstRequestBlockId.add(numPreviousBlocks);

        epoch.firstRequestBlockId.should.be.bignumber.equal(expectedFirstRequestBlockId);
      } else {
        // this epoch is the first request epoch
        (await rootchain.firstFilledORENumber(forkNumber)).should.be.bignumber.equal(epochNumber);
      }
    } else {
      // check ORE'
      // check only if ORE' is filled
      if (epoch.endBlockNumber.cmp(0) !== 0) {
        const previousForkNumber = forkNumber - 1;
        const previousFork = forks[previousForkNumber];
        const forkedBlock = new Data.PlasmaBlock(await rootchain.getBlock(previousForkNumber, previousFork.forkedBlock));

        const previousEpochNumbers = range(forkedBlock.epochNumber, previousFork.lastEpoch + 1);
        const previousEpochs = (await Promise.all(previousEpochNumbers
          .map(epochNumber => rootchain.getEpoch(previousForkNumber, epochNumber))))
          .map(e => new Data.Epoch(e));

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
        noRequestEpoch.should.be.equal(false);

        const firstRequestEpochAfterFork = first(previousRequestEpochs).epoch;
        const lastRequestEpochAfterFork = last(previousRequestEpochs).epoch;

        epoch.requestStart.should.be.bignumber.equal(firstRequestEpochAfterFork.requestStart);
        epoch.requestEnd.should.be.bignumber.equal(lastRequestEpochAfterFork.requestEnd);

        // test previous block and referenceBlock
        let currentBlockNumber = Number(blockNumber);
        for (const e of previousRequestEpochs) {
          const referenceEpoch = e.epoch;
          for (const referenceBlockNumber of range(
            referenceEpoch.startBlockNumber.toNumber(), referenceEpoch.endBlockNumber.toNumber())) {
            const referenceBlock = new Data.PlasmaBlock(await rootchain.getBlock(previousForkNumber, referenceBlockNumber));
            const currentBlock = new Data.PlasmaBlock(await rootchain.getBlock(currentFork, currentBlockNumber));
            currentBlock.referenceBlock.should.be.bignumber.equal(referenceBlockNumber);
            currentBlock.requestBlockId.should.be.bignumber.equal(referenceBlock.requestBlockId);

            currentBlockNumber += 1;
          }
        }
      }
    }

    // check request block
    const numBlocks = epoch.endBlockNumber.sub(epoch.startBlockNumber).add(1);
    block.requestBlockId.should.be.bignumber.gte(epoch.firstRequestBlockId);
    block.requestBlockId.should.be.bignumber.lt(epoch.firstRequestBlockId.add(numBlocks));

    epoch.requestStart.should.be.bignumber.lte(requestBlock.requestStart);
    epoch.requestEnd.should.be.bignumber.gte(requestBlock.requestEnd);
  }

  async function checkLastBlockNumber () {
    (await rootchain.lastBlock(currentFork))
      .should.be.bignumber.equal(forks[currentFork].lastBlock);
  }

  async function checkLastEpoch (isRequest, userActivated, rebase = false) {
    const epoch = new Data.Epoch(await rootchain.getLastEpoch());

    log(`
      checkLastEpoch#${currentFork}.${await rootchain.lastEpoch(currentFork)}
    `);

    epoch.isRequest.should.be.equal(isRequest);
    epoch.userActivated.should.be.equal(userActivated);
    epoch.rebase.should.be.equal(rebase);
  }

  async function checkLastEpochNumber () {
    (await rootchain.lastEpoch(currentFork))
      .should.be.bignumber.equal(forks[currentFork].lastEpoch);
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

      await checkRequestBlock(forks[currentFork].lastBlock);
      await checkLastBlockNumber();
    }
  }

  async function submitDummyURBs (numBlocks, firstURB = true) {
    for (const _ of range(numBlocks)) {
      const tx = await rootchain.submitURB(currentFork, statesRoot, transactionsRoot, receiptsRoot,
        { from: submiter, value: COST_URB });
      logtx(tx);

      if (firstURB) {
        // consume events
        await timeout(3);

        forks[currentFork].lastBlock = forks[currentFork - 1].lastFinalizedBlock + 1;
      } else {
        forks[currentFork].lastBlock += 1;
      }

      firstURB = false;

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

  async function applyRequests (n = 0, userActivated = false) {
    const firstRequestId = userActivated ? ERUToApply : EROToApply;
    const lastRequestId = userActivated
      ? n === 0 ? numERUs : firstRequestId + n
      : n === 0 ? numEROs : firstRequestId + n;

    const getRequest = userActivated ? rootchain.ERUs : rootchain.EROs;

    const requestIds = range(firstRequestId, lastRequestId);

    for (const requestId of requestIds) {
      const requestBefore = new Data.Request(await getRequest(requestId));
      requestBefore.finalized.should.be.equal(false);

      const tokenAmountBefore = await token.balances(requestBefore.requestor);

      const tx = await rootchain.applyRequest();
      logtx(tx);

      await expectEvent.inTransaction(tx, 'RequestFinalized');

      const requestAfter = new Data.Request(await getRequest(requestId));
      requestAfter.finalized.should.be.equal(true);

      const tokenAmountAfter = await token.balances(requestBefore.requestor);

      if (requestBefore.isExit && !requestAfter.challenged) {
        tokenAmountAfter.should.be.bignumber
          .equal(tokenAmountBefore.add(parseInt(requestBefore.trieValue, 16)));
      } else if (requestAfter.challenged) {
        requestAfter.challenged.should.be.equal(true);
        tokenAmountAfter.should.be.bignumber.equal(tokenAmountBefore);
      }
    }

    if (userActivated) {
      ERUToApply += requestIds.length;
    } else {
      EROToApply += requestIds.length;
    }
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

  const testEpochsWithoutRequest = (NRENumber) => {
    const ORENumber = NRENumber + 1;

    before(`check NRE#${NRENumber} parameters`, async () => {
      await logEpoch(currentFork, NRENumber - 2);
      await logEpoch(currentFork, NRENumber - 1);
      await logEpoch(currentFork, NRENumber);

      const fork = forks[currentFork];
      const rebase = currentFork !== 0 && fork.firstEpoch + 3 === fork.lastEpoch;
      const isRequest = NRENumber !== 1 && !rebase;
      const userActivated = false;

      log(`
      [testEpochsWithoutRequest]
      NRENumber: ${NRENumber}
      forks[currentFork].lastEpoch: ${forks[currentFork].lastEpoch}
      rootchain.forks: ${JSON.stringify(new Data.Fork(await rootchain.forks(currentFork)))}
      rootchain.lastEpoch: ${JSON.stringify(new Data.Epoch(await rootchain.getLastEpoch()))}
      `);

      await checkLastBlockNumber();
      await checkLastEpochNumber();
      await checkLastEpoch(isRequest, userActivated, rebase);

      await logEpochAndBlock(currentFork, forks[currentFork].lastEpoch);
      await checkEpoch(forks[currentFork].lastEpoch);
    });

    it(`next empty ORE#${ORENumber} should be prepared`, async () => {
      // submits `NRELength` NRBs
      await submitDummyNRBs(NRELength);

      await logEpochAndBlock(currentFork, forks[currentFork].lastEpoch + 1);
      await logEpochAndBlock(currentFork, forks[currentFork].lastEpoch + 2);

      // because no ERO, ORB epoch is empty
      const isRequest = true;
      const userActivated = false;

      forks[currentFork].lastEpoch += 2;
      await checkEpoch(forks[currentFork].lastEpoch - 1);
      await checkEpoch(forks[currentFork].lastEpoch);

      await checkLastEpoch(isRequest, userActivated);
      await checkLastEpochNumber();
    });

    it('can finalize blocks', finalizeBlocks);
  };

  const makeEpochTest = ({ numEtherEnter = 0, numTokenEnter = 0, numValidExit = 0, numInvalidExit = 0 }) => {
    numEtherEnter = Number(numEtherEnter / others.length);
    numTokenEnter = Number(numTokenEnter / others.length);
    numValidExit = Number(numValidExit / others.length);
    numInvalidExit = Number(numInvalidExit / others.length);

    let firstInvalidExitIndex;
    let firstInvalidExitBlock;
    const noRequests = (numEtherEnter + numTokenEnter + numValidExit + numInvalidExit) === 0;

    const args = { numEtherEnter, numTokenEnter, numValidExit, numInvalidExit };

    const testEpochs = (NRENumber) => {
      const ORENumber = NRENumber + 1;
      let numORBs;
      let numRequests = 0;
      let numRequestBlocks = 1;

      before(`check NRE#${NRENumber} parameters`, async () => {
        log(`
          testEpochs ${JSON.stringify(args)}
          noRequests: ${noRequests}
          numEtherEnter: ${numEtherEnter}
          numTokenEnter: ${numTokenEnter}
          numValidExit: ${numValidExit}
          numInvalidExit: ${numInvalidExit}
        `);

        await logEpoch(currentFork, NRENumber - 2);
        await logEpoch(currentFork, NRENumber - 1);
        await logEpoch(currentFork, NRENumber);

        const fork = forks[currentFork];
        const rebase = currentFork !== 0 && fork.firstEpoch + 2 === fork.lastEpoch;
        const isRequest = NRENumber !== 1 && !rebase;
        const userActivated = false;

        log(`
          fork: ${JSON.stringify(fork)}
          rebase: ${rebase}
          isRequest: ${isRequest}
          userActivated: ${userActivated}
        `);

        await checkLastBlockNumber();
        await checkLastEpochNumber();

        await checkEpoch(forks[currentFork].lastEpoch);
        await checkLastEpoch(isRequest, userActivated, rebase);

        numORBs = (await rootchain.getNumORBs()).toNumber() + 1;
      });

      if (numEtherEnter > 0) {
        it(`NRE#${NRENumber}: user can make an enter request for ether deposit`, async () => {
          const isTransfer = true;

          for (const _ of range(numEtherEnter)) {
            await Promise.all(others.map(async other => {
              const tx = await rootchain.startEnter(isTransfer, other, emptyBytes32, emptyBytes32, {
                from: other,
                value: etherAmount,
              });

              logtx(tx);
            }));

            numEROs += others.length;
            (await rootchain.getNumEROs()).should.be.bignumber.equal(numEROs);

            numRequests += others.length;

            if (MAX_REQUESTS.cmp(numRequests) < 0) {
              numRequests = numRequests - MAX_REQUESTS.toNumber();
              numORBs += 1;
              numRequestBlocks += 1;
            }
          }

          (await rootchain.getNumORBs()).should.be.bignumber.equal(numORBs);
        });
      }

      if (numTokenEnter > 0) {
        it(`NRE#${NRENumber}: user can make an enter request for token deposit`, async () => {
          const isTransfer = false;

          (await rootchain.getNumEROs()).should.be.bignumber.equal(numEROs);

          for (const _ of range(numTokenEnter)) {
            await Promise.all(others.map(async other => {
              const trieKey = calcTrieKey(other);
              const trieValue = padLeft(web3.fromDecimal(tokenAmount));

              (await token.getBalanceTrieKey(other)).should.be.equals(trieKey);

              const tokenBalance = await token.balances(other);
              const tx = await rootchain.startEnter(isTransfer, token.address, trieKey, trieValue, { from: other });
              logtx(tx);

              (await token.balances(other)).should.be.bignumber.equal(tokenBalance.sub(tokenAmount));
            }));

            numEROs += others.length;
            (await rootchain.getNumEROs()).should.be.bignumber.equal(numEROs);

            numRequests += others.length;

            if (MAX_REQUESTS.cmp(numRequests) < 0) {
              numRequests = numRequests - MAX_REQUESTS.toNumber();
              numORBs += 1;
              numRequestBlocks += 1;
            }
          }

          (await rootchain.getNumORBs()).should.be.bignumber.equal(numORBs);
        });
      }

      if (numValidExit > 0) {
        it(`NRE#${NRENumber}: user can make an exit request for token withdrawal`, async () => {
          (await rootchain.getNumEROs()).should.be.bignumber.equal(numEROs);

          for (const _ of range(numValidExit)) {
            await Promise.all(others.map(async other => {
              const trieKey = calcTrieKey(other);
              const trieValue = padLeft(web3.fromDecimal(tokenAmount));

              (await token.getBalanceTrieKey(other)).should.be.equals(trieKey);

              const tx = await rootchain.startExit(token.address, trieKey, trieValue, { from: other, value: COST_ERU });
              logtx(tx);
            }));

            numEROs += others.length;
            (await rootchain.getNumEROs()).should.be.bignumber.equal(numEROs);

            numRequests += others.length;

            if (MAX_REQUESTS.cmp(numRequests) < 0) {
              numRequests = numRequests - MAX_REQUESTS.toNumber();
              numORBs += 1;
              numRequestBlocks += 1;
            }
          }

          (await rootchain.getNumORBs()).should.be.bignumber.equal(numORBs);
        });
      }

      if (numInvalidExit > 0) {
        it(`NRE#${NRENumber}: user can make an exit request for token withdrawal (2)`, async () => {
          (await rootchain.getNumEROs()).should.be.bignumber.equal(numEROs);
          firstInvalidExitBlock = forks[currentFork].lastBlock + NRELength.toNumber() + numRequestBlocks;
          firstInvalidExitIndex = numRequests;

          for (const _ of range(numInvalidExit)) {
            await Promise.all(others.map(async other => {
              const trieKey = calcTrieKey(other);
              const trieValue = padLeft(web3.fromDecimal(tokenAmount));

              (await token.getBalanceTrieKey(other)).should.be.equals(trieKey);

              const tx = await rootchain.startExit(token.address, trieKey, trieValue, { from: other, value: COST_ERU });
              logtx(tx);
            }));

            numEROs += others.length;
            (await rootchain.getNumEROs()).should.be.bignumber.equal(numEROs);

            numRequests += others.length;

            if (MAX_REQUESTS.cmp(numRequests) < 0) {
              numRequests = numRequests - MAX_REQUESTS.toNumber();
              numORBs += 1;
            }
          }

          (await rootchain.getNumORBs()).should.be.bignumber.equal(numORBs);
        });
      }

      it(`NRE#${NRENumber}: operator submits NRBs`, async () => {
        await submitDummyNRBs(NRELength);
        await logEpochAndBlock(currentFork, forks[currentFork].lastEpoch);
        await logEpochAndBlock(currentFork, forks[currentFork].lastEpoch + 1);
        await logEpochAndBlock(currentFork, forks[currentFork].lastEpoch + 2);

        if (noRequests) {
          const isRequest = true;
          const userActivated = false;

          forks[currentFork].lastEpoch += 2;
          await checkEpoch(forks[currentFork].lastEpoch - 1);
          await checkEpoch(forks[currentFork].lastEpoch);

          await checkLastBlockNumber();
          await checkLastEpochNumber();
          await checkLastEpoch(isRequest, userActivated);
          return;
        }

        const isRequest = false;
        const userActivated = false;

        forks[currentFork].lastEpoch += 1;
        await checkEpoch(forks[currentFork].lastEpoch);

        await checkLastBlockNumber();
        await checkLastEpochNumber();
        await checkLastEpoch(isRequest, userActivated);
      });

      if (!noRequests) {
        it(`ORE#${ORENumber}: operator submits ORBs`, async () => {
          const epoch = new Data.Epoch(await rootchain.getEpoch(currentFork, ORENumber));
          await logEpochAndBlock(currentFork, forks[currentFork].lastEpoch);

          const numORBs = epoch.endBlockNumber.sub(epoch.startBlockNumber).add(1);
          await submitDummyORBs(numORBs);

          forks[currentFork].lastEpoch += 1;
          await checkEpoch(forks[currentFork].lastEpoch);

          const isRequest = true;
          const userActivated = false;

          await checkLastEpoch(isRequest, userActivated);
          await checkLastEpochNumber();
        });

        it('cannot finalize requests before block is finalized', async () => {
          await rootchain.applyRequest().should.be.rejectedWith(EVMRevert);
        });

        if (numInvalidExit > 0) {
          it('cannot challenge on exit before challenge period starts', async () => {
            await rootchain.challengeExit(
              currentFork,
              forks[currentFork].lastBlock,
              0,
              failedReceipt,
              dummyProof
            ).should.be.rejectedWith(EVMRevert);
          });
        }

        it('can finalize blocks', finalizeBlocks);

        if (numInvalidExit > 0) {
          it('can challenge on invalid exits', async () => {
            // TODO: can we remove below line?
            await finalizeBlocks();
            await timeout(1);

            const blockNumbers = range(firstInvalidExitBlock, forks[currentFork].lastBlock + 1);

            log(`
              blockNumbers: ${blockNumbers}
            `);

            const getLastExitIndex = (blockNumber) => blockNumber === last(blockNumbers) ? numRequests : MAX_REQUESTS;

            let txIndices = range(firstInvalidExitIndex, getLastExitIndex(first(blockNumbers)));

            for (const blockNumber of blockNumbers) {
              const finalizedAt = await rootchain.getBlockFinalizedAt(currentFork, blockNumber);

              const block = new Data.PlasmaBlock(await rootchain.getBlock(currentFork, blockNumber));
              const rb = new Data.RequestBlock(await rootchain.ORBs(block.requestBlockId));

              log(`
              txIndices: ${txIndices}
              await latestTime(): ${await latestTime()}
              finalizedAt: ${finalizedAt}
              block: ${JSON.stringify(block)}
              rb: ${JSON.stringify(rb)}
              `);

              const b = new Data.PlasmaBlock(await rootchain.getBlock(currentFork, blockNumber));
              b.finalized.should.be.equal(true);

              await Promise.all(txIndices.map(txindex => rootchain.challengeExit(
                currentFork,
                blockNumber,
                txindex,
                failedReceipt,
                dummyProof
              )));

              txIndices = range(0, getLastExitIndex(blockNumber + 1));
            }
          });
        }

        it('should finalize requests', async () => {
          // TODO: can we remove below line?
          await finalizeBlocks();
          await increaseTime(CP_EXIT + 1);

          await applyRequests();
        });
      } else {
        it('can finalize blocks', finalizeBlocks);
      }
    };

    return {
      fname: `testEpochsWithRequest${JSON.stringify(args)}`,
      f: testEpochs,
    };
  };

  /* const testEpochsWithExitRequest = (NRENumber) => {
    const ORENumber = NRENumber + 1;

    before(async () => {
      await logEpoch(currentFork, NRENumber - 2);
      await logEpoch(currentFork, NRENumber - 1);
      await logEpoch(currentFork, NRENumber);

      const fork = forks[currentFork];
      const rebase = currentFork !== 0 && fork.firstEpoch + 2 === fork.lastEpoch;
      const isRequest = NRENumber !== 1 && !rebase;
      const userActivated = false;

      await checkEpoch(forks[currentFork].lastEpoch);
      await checkLastEpoch(isRequest, userActivated, rebase);

      await checkLastBlockNumber();
      await checkLastEpochNumber();
    });

    it(`NRE#${NRENumber}: user can make an exit request for token withdrawal`, async () => {
      const isTransfer = false;

      (await rootchain.getNumEROs()).should.be.bignumber.equal(numEROs);

      const txs = await Promise.all(others.map(other => {
        const trieKey = calcTrieKey(other);
        const trieValue = padLeft(web3.toHex(exitAmount));

        return rootchain.startExit(token.address, trieKey, trieValue, { from: other, value: COST_ERU });
      }));

      txs.forEach(logtx);

      numEROs += others.length;

      (await rootchain.getNumEROs()).should.be.bignumber.equal(numEROs);
    });

    it(`NRE#${NRENumber}: operator submits NRBs`, async () => {
      const isRequest = false;
      const userActivated = false;

      await submitDummyNRBs(NRELength);

      forks[currentFork].lastEpoch += 1;
      await checkEpoch(forks[currentFork].lastEpoch);

      await checkLastEpoch(isRequest, userActivated);
      await checkLastEpochNumber();
    });

    it(`ORE#${ORENumber}: operator submits ORBs`, async () => {
      const isRequest = true;
      const userActivated = false;

      const epoch = new Data.Epoch(await rootchain.getEpoch(currentFork, ORENumber));

      const numORBs = epoch.endBlockNumber.sub(epoch.startBlockNumber).add(1);
      await submitDummyORBs(numORBs);

      forks[currentFork].lastEpoch += 1;
      await checkEpoch(forks[currentFork].lastEpoch);

      await checkLastEpoch(isRequest, userActivated);
      await checkLastEpochNumber();
    });

    it('can finalize blocks', finalizeBlocks);

    it('should finalize requests', applyRequests);
  };

  const testEpochsWithInvalidExitRequest = (NRENumber) => {
    const ORENumber = NRENumber + 1;
    const invalidExit = true;

    before(async () => {
      log(`
        Epoch#${forks[currentFork].lastEpoch - 1} ${await rootchain.getEpoch(currentFork, forks[currentFork].lastEpoch - 1)}
        Epoch#${forks[currentFork].lastEpoch} ${await rootchain.getEpoch(currentFork, forks[currentFork].lastEpoch)}
        `);

      const fork = forks[currentFork];
      const rebase = currentFork !== 0 && fork.firstEpoch + 2 === fork.lastEpoch;
      const isRequest = NRENumber !== 1 && !rebase;
      const userActivated = false;

      await checkEpoch(forks[currentFork].lastEpoch);
      await checkLastEpoch(isRequest, userActivated, rebase);

      await checkLastBlockNumber();
      await checkLastEpochNumber();
    });

    it(`NRE#${NRENumber}: user can make an invalid exit request for token withdrawal`, async () => {
      (await rootchain.getNumEROs()).should.be.bignumber.equal(numEROs);

      const txs = await Promise.all(others.map(other => {
        const trieKey = calcTrieKey(other);
        const trieValue = padLeft(web3.toHex(tokenAmount.mul(10)));

        return rootchain.startExit(token.address, trieKey, trieValue, { from: other, value: COST_ERU });
      }));
      txs.forEach(logtx);

      numEROs += others.length;

      (await rootchain.getNumEROs()).should.be.bignumber.equal(numEROs);
    });

    it(`NRE#${NRENumber}: operator submits NRBs`, async () => {
      const isRequest = false;
      const userActivated = false;

      await submitDummyNRBs(NRELength);

      forks[currentFork].lastEpoch += 1;
      await checkEpoch(forks[currentFork].lastEpoch);

      await checkLastEpoch(isRequest, userActivated);
      await checkLastEpochNumber();
    });

    it(`ORE#${ORENumber}: operator submits ORBs`, async () => {
      const isRequest = true;
      const userActivated = false;

      const epoch = new Data.Epoch(await rootchain.getEpoch(currentFork, ORENumber));

      const numORBs = epoch.endBlockNumber.sub(epoch.startBlockNumber).add(1);
      await submitDummyORBs(numORBs);

      forks[currentFork].lastEpoch += 1;
      await checkEpoch(forks[currentFork].lastEpoch);

      await checkLastEpoch(isRequest, userActivated);
      await checkLastEpochNumber();
    });

    it('can finalize blocks', finalizeBlocks);

    it('can challenge on invalid exit', async () => {
      await logEpochAndBlock(currentFork, ORENumber);
      const epoch = new Data.Epoch(await rootchain.getEpoch(currentFork, ORENumber));

      epoch.isRequest.should.be.equal(true);

      const numORBs = epoch.endBlockNumber.sub(epoch.startBlockNumber).add(1);

      for (const blockNumber of range(epoch.startBlockNumber, epoch.endBlockNumber.add(1))) {
        const block = new Data.PlasmaBlock(await rootchain.getBlock(currentFork, blockNumber));

        block.finalized.should.be.equal(true);

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
          logtx(tx);
        }
      }
    });

    it('should finalize invalid requests', async () => { applyRequests(invalidExit); });
  }; */

  const makeUAFTest = ({
    numNREs = 0,
    numOREs = 0,
    makeEnter = false,
    makeExit = false,
  }) => {
    const args = { numNREs, numOREs, makeEnter, makeExit };

    const isOREEmpty = numOREs === 0;
    const isNREEmpty = numNREs === 0;

    const testUAF = (NRENumber) => {
      const ORENumber = NRENumber + 1;
      let numURBs = 0;
      let numORBs = 0;
      let numNRBs = 0;

      let numNewERUs = 0;
      let numNewEROs = 0;

      before(async () => {
        if (numOREs > numNREs) {
          throw new Error(`numOREs can't be greater than numNREs, but ${numOREs} > ${numNREs}`);
        }

        await logEpoch(currentFork, forks[currentFork].lastEpoch - 1);
        await logEpoch(currentFork, forks[currentFork].lastEpoch);
        await logEpoch(currentFork, forks[currentFork].lastEpoch + 1);

        // finalize all blocks
        await finalizeBlocks();

        // extend unfinalized epcohs
        let i = numNREs;
        let j = numOREs;

        while (i + j > 0) {
          if (i > 0) {
            // create request before submit NRBs
            if (j > 0) {
              if (makeEnter) {
                const txs = await Promise.all(others.map(other => {
                  const isTransfer = false;
                  const trieKey = calcTrieKey(other);
                  const trieValue = padLeft(web3.fromDecimal(tokenAmount));
                  return rootchain.startEnter(isTransfer, token.address, trieKey, trieValue, { from: other });
                }));
                txs.forEach(logtx);
                numEROs += others.length;
                numNewEROs += others.length;
              }

              if (makeExit) {
                const txs = await Promise.all(others.map(other => {
                  const trieKey = calcTrieKey(other);
                  const trieValue = padLeft(web3.toHex(tokenAmount.mul(10)));

                  return rootchain.startExit(token.address, trieKey, trieValue, { from: other, value: COST_ERU });
                }));
                txs.forEach(logtx);
                numEROs += others.length;
                numNewEROs += others.length;
              }
            }

            // submit NRBs
            await submitDummyNRBs(NRELength);
            forks[currentFork].lastEpoch += 1;
            numNRBs += Number(NRELength);
            i--;
          }

          // submit ORBs
          if (j > 0) {
            const epoch = new Data.Epoch(await rootchain.getEpoch(currentFork, ORENumber));
            const numBlocks = epoch.endBlockNumber.sub(epoch.startBlockNumber).add(1);
            await submitDummyORBs(numBlocks);
            forks[currentFork].lastEpoch += 1;
            await logEpoch(currentFork, forks[currentFork].lastEpoch - 2);
            await logEpoch(currentFork, forks[currentFork].lastEpoch - 1);
            await logEpoch(currentFork, forks[currentFork].lastEpoch);
            await logEpoch(currentFork, forks[currentFork].lastEpoch + 1);

            numORBs += Number(numBlocks);
            j--;
          }
        }
      });

      it('should make ERUs', async () => {
        const txs = await Promise.all(others.map(other => {
          const trieKey = calcTrieKey(other);
          const trieValue = padLeft(web3.toHex(tokenAmount.mul(10)));

          return rootchain.makeERU(token.address, trieKey, trieValue, { from: other, value: COST_ERU });
        }));
        txs.forEach(logtx);
        numERUs += others.length;
        numNewERUs += others.length;
        numURBs += 1;
      });

      it('should prepare URE', async () => {
        await rootchain.prepareToSubmitURB({ from: submiter, value: COST_URB_PREPARE });
      });

      const caption = numORBs > 0 ? 'without empty ORE\'' : 'with empty ORE;';

      it(`should submit URB ${caption}`, async () => {
        await newFork();

        const nextFork = new Data.Fork(await rootchain.forks(currentFork));

        log(`Fork#${currentFork} ${JSON.stringify(nextFork)}`);

        await logEpochAndBlock(currentFork, nextFork.lastEpoch);

        await submitDummyURBs(numURBs);

        await checkEpoch(forks[currentFork].lastEpoch);

        if (isOREEmpty && isNREEmpty) {
          forks[currentFork].lastEpoch += 2;

          const isRequest = false;
          const userActivated = false;
          const rebase = true;

          await checkLastEpoch(isRequest, userActivated, rebase);
        } else if (isOREEmpty) {
          forks[currentFork].lastEpoch += 1;

          const isRequest = true;
          const userActivated = false;
          const rebase = true;

          await checkLastEpoch(isRequest, userActivated, rebase);
        } else {
          const isRequest = true;
          const userActivated = true;
          await checkLastEpoch(isRequest, userActivated);
        }

        await checkLastEpochNumber();
      });

      if (!isOREEmpty) {
        it('should rebase ORE\'', async () => {
          const nextFork = new Data.Fork(await rootchain.forks(currentFork));

          await submitDummyORBs(numORBs);
          log(`Fork#${currentFork - 1} ${JSON.stringify(new Data.Fork(await rootchain.forks(currentFork - 1)))}`);
          log(`Fork#${currentFork} ${JSON.stringify(new Data.Fork(await rootchain.forks(currentFork)))}`);

          await logEpochAndBlock(currentFork, nextFork.lastEpoch);

          forks[currentFork].lastEpoch += 1;
          await checkEpoch(forks[currentFork].lastEpoch);

          const isRequest = true;
          const userActivated = false;
          const rebase = true;
          await checkLastEpoch(isRequest, userActivated, rebase);
          await checkLastEpochNumber();
        });
      }

      if (!isNREEmpty) {
        it('should rebase NRE\'', async () => {
          const nextFork = new Data.Fork(await rootchain.forks(currentFork));

          await submitDummyNRBs(numNRBs);
          log(`Fork#${currentFork - 1} ${JSON.stringify(new Data.Fork(await rootchain.forks(currentFork - 1)))}`);
          log(`Fork#${currentFork} ${JSON.stringify(new Data.Fork(await rootchain.forks(currentFork)))}`);

          await logEpochAndBlock(currentFork, nextFork.lastEpoch);

          forks[currentFork].lastEpoch += 1;
          await checkEpoch(forks[currentFork].lastEpoch);

          const isRequest = false;
          const userActivated = false;
          const rebase = true;
          await checkLastEpoch(isRequest, userActivated, rebase);
          await checkLastEpochNumber();
        });
      }

      it('should finalize blocks', finalizeBlocks);

      it('should not finalize ERUs before exit challenge period ends', async () => {
        await rootchain.applyRequest().should.be.rejectedWith(EVMRevert);
      });

      it('should finalize ERUs after exit challenge period ends', async () => {
        await increaseTime(CP_EXIT + 1);
        await applyRequests(numNewERUs, true);
      });

      it('should finalize EROs', async () => {
        await applyRequests(0, false);
      });
    };

    return {
      fname: `testUAF${JSON.stringify(args)}`,
      f: testUAF,
      isUAF: true,
    };
  };

  const tests = [];

  // // scenario 1
  tests.push(makeEpochTest({ numEtherEnter: 0, numValidExit: 0 }));
  tests.push(makeEpochTest({ numEtherEnter: 0, numValidExit: 0 }));
  tests.push(makeEpochTest({ numEtherEnter: 0, numValidExit: 0 }));
  tests.push(makeEpochTest({
    numEtherEnter: 1 * others.length,
    numTokenEnter: 1 * others.length,
    numValidExit: 0,
  }));
  tests.push(makeEpochTest({
    numEtherEnter: 2 * others.length,
    numTokenEnter: 2 * others.length,
    numValidExit: 0,
  }));
  tests.push(makeEpochTest({
    numEtherEnter: 3 * others.length,
    numTokenEnter: 3 * others.length,
    numValidExit: 0,
  }));
  tests.push(makeEpochTest({
    numEtherEnter: 3 * others.length,
    numTokenEnter: 3 * others.length,
    numValidExit: 4 * others.length,
  }));
  tests.push(makeUAFTest({
    numNREs: 1,
    numOREs: 1,
    makeEnter: true,
    makeExit: true,
  }));
  tests.push(makeEpochTest({ numEtherEnter: 0, numValidExit: 40 * others.length }));

  // scenario 2
  // tests.push(makeEpochTest({ numEtherEnter: 0, numValidExit: 0 }));
  // tests.push(makeEpochTest({
  //   numEtherEnter: 1 * others.length,
  //   numTokenEnter: 1 * others.length,
  //   numValidExit: 1 * others.length,
  //   numInvalidExit: 0 * others.length,
  // }));
  // tests.push(makeUAFTest({
  //   numNREs: 1,
  //   numOREs: 1,
  //   makeEnter: true,
  //   makeExit: true,
  // }));
  // tests.push(makeEpochTest({
  //   numEtherEnter: 1 * others.length,
  //   numTokenEnter: 1 * others.length,
  //   numValidExit: 1 * others.length,
  //   numInvalidExit: 1 * others.length,
  // }));

  // scenario 3: no fork
  // tests.push(makeEpochTest({ numEtherEnter: 0, numValidExit: 0 }));
  // tests.push(makeEpochTest({
  //   numEtherEnter: 1 * others.length,
  //   numTokenEnter: 1 * others.length,
  //   numValidExit: 1 * others.length,
  //   numInvalidExit: 0 * others.length,
  // }));
  // tests.push(makeEpochTest({
  //   numEtherEnter: 1 * others.length,
  //   numTokenEnter: 1 * others.length,
  //   numValidExit: 1 * others.length,
  //   numInvalidExit: 1 * others.length,
  // }));
  // tests.push(makeEpochTest({
  //   numEtherEnter: 0 * others.length,
  //   numTokenEnter: 0 * others.length,
  //   numValidExit: 0 * others.length,
  //   numInvalidExit: 1 * others.length,
  // }));
  // tests.push(makeEpochTest({
  //   numEtherEnter: 0 * others.length,
  //   numTokenEnter: 0 * others.length,
  //   numValidExit: 1 * others.length,
  //   numInvalidExit: 0 * others.length,
  // }));
  // tests.push(makeEpochTest({
  //   numEtherEnter: 0 * others.length,
  //   numTokenEnter: 1 * others.length,
  //   numValidExit: 1 * others.length,
  //   numInvalidExit: 0 * others.length,
  // }));

  // generate mocha test cases
  let forkNumber = 0;
  let epochNumber = 1;
  for (const i of range(0, tests.length)) {
    const t = tests[i];

    const {
      fname = t.name,
      f = t,
      isUAF = false,
    } = t;

    if (isUAF) {
      forkNumber += 1;
    }

    describe(`${i + 1}: Fork#${forkNumber} Epoch#${epochNumber} (${fname})`, () => {
      f(epochNumber);
    });

    if (isUAF) {
      epochNumber += 3;
    } else {
      epochNumber += 2;
    }
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
