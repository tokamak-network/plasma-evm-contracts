class Fork {
  constructor ([
    blockToRenew,
    forkedBlock,
    lastRebasedPreviousRequestEpoch,
    lastRebasedPreviousNonRequestEpoch,
    firstEpoch,
    lastEpoch,
    firstBlock,
    lastBlock,
    lastFinalizedBlock,
  ]) {
    this.blockToRenew = blockToRenew;
    this.forkedBlock = forkedBlock;
    this.lastRebasedPreviousRequestEpoch = lastRebasedPreviousRequestEpoch;
    this.lastRebasedPreviousNonRequestEpoch = lastRebasedPreviousNonRequestEpoch;
    this.firstEpoch = firstEpoch;
    this.lastEpoch = lastEpoch;
    this.firstBlock = firstBlock;
    this.lastBlock = lastBlock;
    this.lastFinalizedBlock = lastFinalizedBlock;
  }
}

class Epoch {
  constructor ([
    requestStart,
    requestEnd,
    startBlockNumber,
    endBlockNumber,
    forkedBlockNumber,
    firstRequestBlockId,
    timestamp,
    isEmpty,
    initialized,
    isRequest,
    userActivated,
  ]) {
    this.requestStart = requestStart;
    this.requestEnd = requestEnd;
    this.startBlockNumber = startBlockNumber;
    this.endBlockNumber = endBlockNumber;
    this.forkedBlockNumber = forkedBlockNumber;
    this.firstRequestBlockId = firstRequestBlockId;
    this.timestamp = timestamp;
    this.isEmpty = isEmpty;
    this.initialized = initialized;
    this.isRequest = isRequest;
    this.userActivated = userActivated;
  }
}

class PlasmaBlock {
  constructor ([
    epochNumber,
    previousBlockNUmber,
    requestBlockId,
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
    this.previousBlockNUmber = previousBlockNUmber;
    this.requestBlockId = requestBlockId;
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
    epochNumber,
    requestStart,
    requestEnd,
    trie,
  ]) {
    this.submitted = submitted;
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
