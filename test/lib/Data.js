class Fork {
  constructor ([
    forkedBlock,
    firstEpoch,
    lastEpoch,
    firstBlock,
    lastBlock,
    lastFinalizedBlock,
    timestamp,
    firstEnterEpoch,
    lastEnterEpoch,
    nextBlockToRebase,
    rebased,
  ]) {
    // this.blockToRenew = blockToRenew;
    this.forkedBlock = forkedBlock;
    this.firstEpoch = firstEpoch;
    this.lastEpoch = lastEpoch;
    this.firstBlock = firstBlock;
    this.lastBlock = lastBlock;
    this.lastFinalizedBlock = lastFinalizedBlock;
    this.timestamp = timestamp;
    this.firstEnterEpoch = firstEnterEpoch;
    this.lastEnterEpoch = lastEnterEpoch;
    this.nextBlockToRebase = nextBlockToRebase;
    this.rebased = rebased;
  }
}

class Epoch {
  constructor ([
    requestStart,
    requestEnd,
    startBlockNumber,
    endBlockNumber,
    firstRequestBlockId,
    nextEnterEpoch,
    isEmpty,
    initialized,
    isRequest,
    userActivated,
    rebase,
  ]) {
    this.requestStart = requestStart;
    this.requestEnd = requestEnd;
    this.startBlockNumber = startBlockNumber;
    this.endBlockNumber = endBlockNumber;
    this.firstRequestBlockId = firstRequestBlockId;
    this.nextEnterEpoch = nextEnterEpoch;
    this.isEmpty = isEmpty;
    this.initialized = initialized;
    this.isRequest = isRequest;
    this.userActivated = userActivated;
    this.rebase = rebase;
  }
}

class PlasmaBlock {
  constructor ([
    epochNumber,
    requestBlockId,
    referenceBlock,
    timestamp,
    statesRoot,
    transactionsRoot,
    receiptsRoot,
    isRequest,
    userActivated,
    challenged,
    challenging,
    finalized,
  ]) {
    this.epochNumber = epochNumber;
    this.requestBlockId = requestBlockId;
    this.referenceBlock = referenceBlock;
    this.timestamp = timestamp;
    this.statesRoot = statesRoot;
    this.transactionsRoot = transactionsRoot;
    this.receiptsRoot = receiptsRoot;
    this.isRequest = isRequest;
    this.userActivated = userActivated;
    this.challenged = challenged;
    this.challenging = challenging;
    this.finalized = finalized;
  }
}

class Request {
  constructor ([
    timestamp,
    isExit,
    isTransfer,
    finalized,
    challenged,
    value,
    requestor,
    to,
    trieKey,
    trieValue,
    hash,
  ]) {
    this.timestamp = timestamp;
    this.isExit = isExit;
    this.isTransfer = isTransfer;
    this.finalized = finalized;
    this.challenged = challenged;
    this.value = value;
    this.requestor = requestor;
    this.to = to;
    this.trieKey = trieKey;
    this.trieValue = trieValue;
    this.hash = hash;
  }
}

class RequestBlock {
  constructor ([
    submitted,
    numEnter,
    epochNumber,
    requestStart,
    requestEnd,
    trie,
  ]) {
    this.submitted = submitted;
    this.numEnter = numEnter;
    this.epochNumber = epochNumber;
    this.requestStart = requestStart;
    this.requestEnd = requestEnd;
    this.trie = trie;
  }
}

module.exports = {
  Fork,
  Epoch,
  PlasmaBlock,
  Request,
  RequestBlock,
};
