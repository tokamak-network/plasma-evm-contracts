pragma solidity ^0.4.24;

import "./lib/SafeMath.sol";
import "./lib/Math.sol";
import "./lib/Data.sol";
import "./lib/Address.sol";
import "./lib/BMT.sol";
// import "./patricia_tree/PatriciaTreeFace.sol";

import "./RootChainStorage.sol";
import "./RootChainEvent.sol";

// TODO: use SafeMath
// TODO: remove state. use epoch.isRequest and epoch.userActivated
contract RootChain is RootChainStorage, RootChainEvent {
  using SafeMath for uint;
  using SafeMath for uint64;
  using Math for *;
  using Data for *;
  using Address for address;
  using BMT for *;

  /*
   * Modifier
   */
  modifier onlyOperator() {
    require(msg.sender == operator);
    _;
  }

  modifier onlyValidCost(uint _expected) {
    require(msg.value >= _expected);
    _;
  }

  modifier finalizeBlocks() {
    if (!development) {
      _finalizeBlock();
    }
    _;
  }

  modifier checkURBSubmission () {
    Data.Fork storage fork = forks[currentFork];
    if (fork.timestamp + Data.URE_TIMEOUT() < block.timestamp) {
      // TODO: reset fork
      fork.forkedBlock = 0;
    }
    _;
  }

  /*
   * Constructor
   */
  constructor(
    address _epochHandler,
    bool _development,
    uint _NRELength,

    // genesis block state
    bytes32 _statesRoot,
    bytes32 _transactionsRoot,
    bytes32 _receiptsRoot
  )
    public
  {
    require(_epochHandler != address(0));
    require(_epochHandler.isContract());

    epochHandler = _epochHandler;
    development = _development;
    operator = msg.sender;
    NRELength = _NRELength;

    Data.Fork storage fork = forks[currentFork];
    Data.PlasmaBlock storage genesis = fork.blocks[0];
    genesis.statesRoot = _statesRoot;
    genesis.transactionsRoot = _transactionsRoot;
    genesis.receiptsRoot = _receiptsRoot;

    // set up the genesis epoch
    fork.epochs[0].timestamp = uint64(block.timestamp);
    fork.epochs[0].initialized = true;

    _doFinalize(fork, genesis, 0);
    _prepareToSubmitNRB();
  }

  /*
   * External Functions
   */

  /**
   * @notice map requestable contract in child chain
   * NOTE: only operator?
   */
  function mapRequestableContractByOperator(address _rootchain, address _childchain)
    external
    onlyOperator
    returns (bool success)
  {
    require(_rootchain.isContract());
    require(requestableContracts[_rootchain] == address(0));

    requestableContracts[_rootchain] = _childchain;
    return true;
  }

  function getNumEROs() external view returns (uint) {
    return EROs.length;
  }

  function getNumORBs() external view returns (uint) {
    return ORBs.length;
  }

  function getEROBytes(uint _requestId) public view returns (bytes memory out) {
    Data.Request storage ERO = EROs[_requestId];

    return ERO.toChildChainRequest(requestableContracts[ERO.to])
      .toTX(_requestId, false)
      .toBytes();
  }

  /**
   * @notice Declare to submit URB.
   */
  function prepareToSubmitURB()
    external
    payable
    onlyValidCost(COST_URB_PREPARE)
    // finalizeBlocks
  {
    // delegate to epoch handler
    require(epochHandler.delegatecall(bytes4(keccak256("prepareToSubmitURB()"))));
  }

  // TODO: Delegate the validity check to TrueBit Verification Game contracts
  function submitNRB(
    uint _forkNumber,
    bytes32 _statesRoot,
    bytes32 _transactionsRoot,
    bytes32 _receiptsRoot
  )
    external
    payable
    onlyOperator
    onlyValidCost(COST_NRB)
    finalizeBlocks
    returns (bool success)
  {
    require(currentFork == _forkNumber);

    Data.Fork storage curFork = forks[_forkNumber];

    uint epochNumber;
    uint blockNumber;

    // If not forked or already rebased
    if (_forkNumber == 0 || forks[_forkNumber - 1].forkedBlock != 0 && curFork.rebased) {
      (epochNumber, blockNumber) = curFork.insertBlock(
        _statesRoot,
        _transactionsRoot,
        _receiptsRoot,
        false,
        false,
        false
      );

      emit BlockSubmitted(
        _forkNumber,
        epochNumber,
        blockNumber,
        false,
        false
      );

      if (blockNumber == curFork.epochs[epochNumber].endBlockNumber) {
        _prepareToSubmitORB();
      }

      return;
    }

    // Otherwise, compare to block in previous fork
    (epochNumber, blockNumber) = curFork.insertBlock(
      _statesRoot,
      _transactionsRoot,
      _receiptsRoot,
      false,
      false,
      true
    );

    curFork.blocks[blockNumber].referenceBlock = curFork.nextBlockToRebase;

    Data.Fork storage preFork = forks[_forkNumber - 1];

    require(_transactionsRoot == preFork.blocks[curFork.nextBlockToRebase].transactionsRoot);

    emit BlockSubmitted(
      _forkNumber,
      epochNumber,
      blockNumber,
      false,
      false
    );

    // if NRB' is filled.
    if (curFork.checkNextNRBToRebase(preFork)) {
      curFork.epochs[epochNumber].endBlockNumber = uint64(blockNumber);
      curFork.rebased = true;

      emit EpochRebased(
        _forkNumber,
        epochNumber,
        curFork.epochs[epochNumber].startBlockNumber,
        blockNumber,
        0,
        0,
        false,
        false,
        false
      );

      _prepareToSubmitNRB();
    }

    // set next block to rebase iterating epochs
    return true;
  }

  function submitORB(
    uint _forkNumber,
    bytes32 _statesRoot,
    bytes32 _transactionsRoot,
    bytes32 _receiptsRoot
  )
    external
    payable
    onlyOperator
    onlyValidCost(COST_ORB)
    finalizeBlocks
    returns (bool success)
  {
    require(currentFork == _forkNumber);
    Data.Fork storage curFork = forks[_forkNumber];

    uint epochNumber;
    uint blockNumber;
    uint requestBlockId;

    // If not forked or already rebased
    if (_forkNumber == 0 || forks[_forkNumber - 1].forkedBlock != 0 && curFork.rebased) {
      (epochNumber, blockNumber) = curFork.insertBlock(
        _statesRoot,
        _transactionsRoot,
        _receiptsRoot,
        true,
        false,
        false
      );

      if (!development) {
        _transactionsRoot._checkTxRoot(
          ORBs[curFork.blocks[curFork.lastBlock].requestBlockId],
          EROs,
          false
        );
      }

      requestBlockId = curFork.blocks[blockNumber].requestBlockId;

      // accunulate # of enters into epoch
      curFork.epochs[epochNumber].numEnter += ORBs[requestBlockId].numEnter;

      emit BlockSubmitted(
        _forkNumber,
        epochNumber,
        blockNumber,
        true,
        false
      );

      if (blockNumber == curFork.epochs[epochNumber].endBlockNumber) {
        _prepareToSubmitNRB();
      }

      return;
    }

    // Otherwise, compare to block in previous fork
    (epochNumber, blockNumber) = curFork.insertBlock(
      _statesRoot,
      _transactionsRoot,
      _receiptsRoot,
      true,
      false,
      true
    );

    Data.Fork storage preFork = forks[_forkNumber - 1];
    Data.PlasmaBlock storage curBlock = curFork.blocks[blockNumber];

    curBlock.referenceBlock = curFork.nextBlockToRebase;
    curBlock.requestBlockId = preFork.blocks[curFork.nextBlockToRebase].requestBlockId;

    if (!development) {
      _transactionsRoot._checkTxRoot(
        ORBs[curBlock.requestBlockId],
        EROs,
        true
      );
    }

    emit BlockSubmitted(
      _forkNumber,
      epochNumber,
      blockNumber,
      true,
      false
    );

    // if ORB' is filled.
    if (curFork.checkNextORBToRebase(preFork, ORBs)) {
      curFork.epochs[epochNumber].endBlockNumber = uint64(blockNumber);

      emit EpochRebased(
        _forkNumber,
        epochNumber,
        curFork.epochs[epochNumber].startBlockNumber,
        blockNumber,
        curFork.epochs[epochNumber].requestStart,
        0,
        false,
        true,
        false
      );

      prepareNREAfterURE();
    }

    // set next block to rebase iterating epochs
    return true;
  }

  function submitURB(
    uint _forkNumber,
    bytes32 _statesRoot,
    bytes32 _transactionsRoot,
    bytes32 _receiptsRoot
  )
    external
    payable
    onlyValidCost(COST_URB)
    returns (bool success)
  {
    bool firstURB = currentFork + 1 == _forkNumber;
    require(firstURB || currentFork == _forkNumber);

    Data.Fork storage fork = forks[_forkNumber];

    if (firstURB) {
      currentFork += 1;
      fork = forks[_forkNumber];

      require(fork.timestamp + Data.URE_TIMEOUT() > block.timestamp);

      emit Forked(_forkNumber, fork.lastEpoch, fork.firstBlock);
    }

    Data.Epoch storage epoch = fork.epochs[fork.lastEpoch];

    require(epoch.isRequest);
    require(epoch.userActivated);

    // set blockNumber as the forked block number if it is first URB
    uint blockNumber = firstURB ?
      fork.firstBlock :
      fork.lastBlock.add64(1);

    Data.PlasmaBlock storage b = fork.blocks[blockNumber];

    b.epochNumber = fork.lastEpoch;
    b.statesRoot = _statesRoot;
    b.transactionsRoot = _transactionsRoot;
    b.receiptsRoot = _receiptsRoot;
    b.timestamp = uint64(block.timestamp);
    b.isRequest = true;
    b.userActivated = true;

    fork.lastBlock = uint64(blockNumber);

    if (!development) {
      _transactionsRoot._checkTxRoot(
        URBs[fork.blocks[fork.lastBlock].requestBlockId],
        ERUs,
        false
      );
    }

    emit BlockSubmitted(
      currentFork,
      fork.lastEpoch,
      blockNumber,
      true,
      true
    );

    // TODO: use internal function to avoide stack too deep error
    if (blockNumber == epoch.endBlockNumber) {
      prepareOREAfterURE();
    }

    return true;
  }

  function finalizeBlock() external returns (bool success) {
    require(_finalizeBlock());
    return true;
  }

  /**
   * @notice Computation verifier contract reverts the block in case of wrong
   *         computation.
   */
  /* function revertBlock(uint _forkNumber, uint _blockNumber) external {
    // TODO: make a new fork?
  } */

  function challengeExit(
    uint _forkNumber,
    uint _blockNumber,
    uint _index,
    bytes _receiptData,
    bytes _proof
  ) external {
    Data.Fork storage fork = forks[_forkNumber];
    Data.PlasmaBlock storage pb = fork.blocks[_blockNumber];

    require(pb.isRequest);
    require(pb.finalized);

    uint requestId;
    bool userActivated = pb.userActivated;

    if (userActivated) {
      requestId = _doChallengeExit(pb, URBs[pb.requestBlockId], ERUs, _index, _receiptData, _proof);
      // TODO: dynamic cost for ERU
      msg.sender.transfer(COST_ERU);
    } else {
      requestId = _doChallengeExit(pb, ORBs[pb.requestBlockId], EROs,_index, _receiptData, _proof);
      msg.sender.transfer(COST_ERO);
    }

    emit RequestChallenged(requestId, userActivated);
  }

  function _doChallengeExit(
    Data.PlasmaBlock storage _pb,
    Data.RequestBlock storage _rb,
    Data.Request[] storage _rs,
    uint _index,
    bytes _receiptData,
    bytes _proof
  )
    internal
    returns (uint requestId)
  {
    requestId = _rb.requestStart + _index;
    require(requestId <= _rb.requestEnd);

    Data.Request storage r = _rs[requestId];

    require(_pb.finalizedAt + CP_EXIT > block.timestamp);
    require(_pb.finalized);
    require(!r.challenged);
    require(!r.finalized);

    bytes32 leaf = keccak256(_receiptData);

    require(_receiptData.toReceiptStatus() == 0);
    if (!development) {
      require(BMT.checkMembership(leaf, _index, _pb.receiptsRoot, _proof));
    }

    r.challenged = true;

    return;
  }

  /**
   * @notice It challenges on NRBs containing null address transaction.
   */
  function challengeNullAddress(
    uint _blockNumber,
    bytes _key,
    bytes _txByte, // RLP encoded transaction
    uint _branchMask,
    bytes32[] _siblings
  ) external {
    Data.Fork storage fork = forks[currentFork];
    Data.PlasmaBlock storage pb = fork.blocks[_blockNumber];

    // check if the plasma block is NRB
    require(!pb.isRequest);

    // check if challenge period does not end yet
    require(pb.timestamp + CP_COMPUTATION > block.timestamp);

    // PatriciaTreeFace trie;
    // if (pb.userActivated) {
    //   trie = PatriciaTreeFace(URBs[pb.requestBlockId].trie);
    // } else {
    //   trie = PatriciaTreeFace(ORBs[pb.requestBlockId].trie);
    // }

    // Data.TX memory txData = Data.toTX(_txByte);
    // require(txData.isNATX());

    // TODO: use patricia verify library
    // require(trie.verifyProof(pb.transactionsRoot, _key, _txByte, _branchMask, _siblings));

    // TODO: fork? penalize?
  }

  /*
   * Public Functions
   */
  function startExit(
    address _to,
    bytes32 _trieKey,
    bytes32 _trieValue
  )
    public
    payable
    onlyValidCost(COST_ERO)
    returns (bool success)
  {
    require(_trieValue != bytes32(0));

    uint requestId;
    requestId = _storeRequest(EROs, ORBs, false, _to, 0, _trieKey, _trieValue, true, false);

    emit RequestCreated(requestId, msg.sender, _to, 0, _trieKey, _trieValue, false, true, false);
    return true;
  }

  function startEnter(
    bool _isTransfer,
    address _to,
    bytes32 _trieKey,
    bytes32 _trieValue
  )
    public
    payable
    returns (bool success)
  {
    uint requestId;
    uint weiAmount = msg.value;
    requestId = _storeRequest(EROs, ORBs, _isTransfer, _to, weiAmount, _trieKey, _trieValue, false, false);
    numEnterForORB += 1;

    Data.Fork storage fork = forks[currentFork];

    emit RequestApplied(requestId, false);
    emit RequestCreated(requestId, msg.sender, _to, weiAmount, _trieKey, _trieValue, _isTransfer, false, false);
    return true;
  }

  function makeERU(
    address _to,
    bytes32 _trieKey,
    bytes32 _trieValue
  )
    public
    payable
    onlyValidCost(COST_ERU)
    returns (bool success)
  {
    uint requestId;
    requestId = _storeRequest(ERUs, URBs, false, _to, 0, _trieKey, _trieValue, true, true);

    emit RequestCreated(requestId, msg.sender, _to, 0, _trieKey, _trieValue, false, true, true);
    return true;
  }

  /**
   * @notice Apply last exit request. this returns the bond in both of
   *         request types.
   * @notice Apply a request in root chain if request block including it
   *         is finalized.
   * TODO: refactor implementation
   */
  function applyRequest() external returns (bool success) {
    uint epochNumber;
    uint requestId;
    Data.Fork storage fork = forks[lastAppliedForkNumber];

    require(lastAppliedBlockNumber <= fork.lastBlock);

    Data.PlasmaBlock storage pb = fork.blocks[lastAppliedBlockNumber];
    epochNumber = pb.epochNumber;

    Data.Epoch storage epoch = fork.epochs[epochNumber];

    // find next fork
    if (fork.forkedBlock != 0 && lastAppliedBlockNumber >= fork.forkedBlock) {
      lastAppliedForkNumber += 1;
      fork = forks[lastAppliedForkNumber];

      epochNumber = fork.firstEpoch;
      epoch = fork.epochs[epochNumber];

      lastAppliedBlockNumber = fork.firstBlock;
      pb = fork.blocks[lastAppliedBlockNumber];
    }

    // find next request block
    if (!pb.isRequest) {
      while (!epoch.isRequest || epoch.isEmpty) {
        require(fork.epochs[epochNumber].initialized);
        epochNumber = epochNumber + 1;
        epoch = fork.epochs[epochNumber];
      }

      lastAppliedBlockNumber = epoch.startBlockNumber;
      pb = fork.blocks[lastAppliedBlockNumber];
    }

    require(!epoch.isEmpty);
    require(epoch.isRequest);
    require(pb.isRequest);
    require(pb.finalized);
    require(pb.finalizedAt + CP_EXIT < block.timestamp);

    // apply ERU
    if (pb.userActivated) {
      requestId = lastAppliedERU;

      require(ERUs.length > requestId);

      Data.Request storage ERU = ERUs[requestId];
      Data.RequestBlock storage URB = URBs[pb.requestBlockId];

      require(URB.requestStart <= requestId && requestId <= URB.requestEnd);

      // check next block
      if (requestId == URB.requestEnd) {
        if (fork.forkedBlock > 0 && lastAppliedBlockNumber == fork.forkedBlock - 1) {
          lastAppliedForkNumber += 1;
        }

        lastAppliedBlockNumber += 1;
      }

      lastAppliedERU = requestId + 1;

      if (ERU.isExit && !ERU.challenged) {
        // NOTE: do not check it reverted or not?
        ERU.applyRequestInRootChain(requestId);
        // TODO: dynamic cost and bond release period
        ERU.requestor.transfer(COST_ERU);
        emit RequestApplied(requestId, true);
      }
      ERU.finalized = true;

      emit RequestFinalized(requestId, true);
      return true;
    }

    // apply ERO
    requestId = lastAppliedERO;

    require(EROs.length > requestId);

    Data.Request storage ERO = EROs[requestId];
    Data.RequestBlock storage ORB = ORBs[pb.requestBlockId];

    require(ORB.requestStart <= requestId && requestId <= ORB.requestEnd);

    // check next block
    if (requestId == ORB.requestEnd) {
      if (fork.forkedBlock > 0 && lastAppliedBlockNumber == fork.forkedBlock - 1) {
        lastAppliedForkNumber += 1;
      }

      lastAppliedBlockNumber += 1;
    }

    lastAppliedERO = requestId + 1;

    if (ERO.isExit && !ERO.challenged) {
      // NOTE: do not check it reverted or not?
      ERO.applyRequestInRootChain(requestId);
      ERO.requestor.transfer(COST_ERO);
      emit RequestApplied(requestId, false);
    }
    ERO.finalized = true;

    emit RequestFinalized(requestId, false);
    return true;
  }

  /**
   * @notice return the max number of request
   */
  function MAX_REQUESTS() public pure returns (uint maxRequests) {
    return Data.MAX_REQUESTS();
  }

  function lastBlock(uint forkNumber) public view returns (uint lastBlock) {
    return forks[forkNumber].lastBlock;
  }

  function lastEpoch(uint forkNumber) public view returns (uint lastBlock) {
    return forks[forkNumber].lastEpoch;
  }

  function getEpoch(
    uint forkNumber,
    uint epochNumber
  ) public view returns (
    uint64 requestStart,
    uint64 requestEnd,
    uint64 startBlockNumber,
    uint64 endBlockNumber,
    uint64 firstRequestBlockId,
    uint64 numEnter,
    bool isEmpty,
    bool initialized,
    bool isRequest,
    bool userActivated,
    bool rebase
  ) {
    Data.Epoch storage epoch = forks[forkNumber].epochs[epochNumber];

    return
    (
      epoch.requestStart,
      epoch.requestEnd,
      epoch.startBlockNumber,
      epoch.endBlockNumber,
      epoch.firstRequestBlockId,
      epoch.numEnter,
      epoch.isEmpty,
      epoch.initialized,
      epoch.isRequest,
      epoch.userActivated,
      epoch.rebase
    );
  }

  function getLastEpoch() public view returns (
    uint64 requestStart,
    uint64 requestEnd,
    uint64 startBlockNumber,
    uint64 endBlockNumber,
    uint64 firstRequestBlockId,
    uint64 numEnter,
    bool isEmpty,
    bool initialized,
    bool isRequest,
    bool userActivated,
    bool rebase
  ) {
    Data.Epoch storage epoch = forks[currentFork].epochs[forks[currentFork].lastEpoch];

    return
    (
      epoch.requestStart,
      epoch.requestEnd,
      epoch.startBlockNumber,
      epoch.endBlockNumber,
      epoch.firstRequestBlockId,
      epoch.numEnter,
      epoch.isEmpty,
      epoch.initialized,
      epoch.isRequest,
      epoch.userActivated,
      epoch.rebase
    );
  }

  function getBlock(
    uint forkNumber,
    uint blockNumber
  ) public view returns (
    uint64 epochNumber,
    uint64 requestBlockId,
    uint64 referenceBlock,
    uint64 timestamp,
    bytes32 statesRoot,
    bytes32 transactionsRoot,
    bytes32 receiptsRoot,
    bool isRequest,
    bool userActivated,
    bool challenged,
    bool challenging,
    bool finalized
  ) {
    epochNumber = forks[forkNumber].blocks[blockNumber].epochNumber;
    requestBlockId = forks[forkNumber].blocks[blockNumber].requestBlockId;
    referenceBlock = forks[forkNumber].blocks[blockNumber].referenceBlock;
    timestamp = forks[forkNumber].blocks[blockNumber].timestamp;
    statesRoot = forks[forkNumber].blocks[blockNumber].statesRoot;
    transactionsRoot = forks[forkNumber].blocks[blockNumber].transactionsRoot;
    receiptsRoot = forks[forkNumber].blocks[blockNumber].receiptsRoot;
    isRequest = forks[forkNumber].blocks[blockNumber].isRequest;
    userActivated = forks[forkNumber].blocks[blockNumber].userActivated;
    challenged = forks[forkNumber].blocks[blockNumber].challenged;
    challenging = forks[forkNumber].blocks[blockNumber].challenging;
    finalized = forks[forkNumber].blocks[blockNumber].finalized;

    return;
  }

  function getBlockFinalizedAt(
    uint forkNumber,
    uint blockNumber
  ) public view returns (uint) {
    return forks[forkNumber].blocks[blockNumber].finalizedAt;
  }

  function getLastFinalizedBlock(uint forkNumber) public view returns (uint) {
    return forks[forkNumber].lastFinalizedBlock;
  }

  /**
   * @notice return true if the chain is forked by URB
   */
  function forked(uint _forkNumber) public view returns (bool result) {
    return _forkNumber != currentFork;
  }

  /**
   * @notice return true if the request is finalized
   */
  function getRequestFinalized(uint _requestId, bool _userActivated) public view returns (bool finalized) {
    if (_userActivated) {
      ERUs[_requestId].finalized;
    }

    return EROs[_requestId].finalized;
  }

  /*
   * Internal Functions
   */
  function _storeRequest(
    Data.Request[] storage _requests,
    Data.RequestBlock[] storage _rbs,
    bool _isTransfer,
    address _to,
    uint _weiAmount,
    bytes32 _trieKey,
    bytes32 _trieValue,
    bool _isExit,
    bool _userActivated
  )
    internal
    returns (uint requestId)
  {
    // NOTE: issue
    // check parameters for simple ether transfer and message-call
    require(_isTransfer || (requestableContracts[_to] != address(0)));

    if (_isTransfer) {
      // NOTE: issue
      require(_weiAmount != 0 && _trieKey == bytes32(0) && _trieValue == bytes32(0));
    }

    requestId = _requests.length++;
    Data.Request storage r = _requests[requestId];

    r.requestor = msg.sender;
    r.value = uint128(_weiAmount);
    r.to = _to;
    r.trieKey = _trieKey;
    r.trieValue = _trieValue;
    r.timestamp = uint64(block.timestamp);
    r.isExit = _isExit;
    r.isTransfer = _isTransfer;

    // apply message-call
    if (!_isExit && !_isTransfer) {
      require(r.applyRequestInRootChain(requestId));
    }

    uint requestBlockId;
    if (_rbs.length == 0) {
      _rbs.length++;
      requestBlockId = 0;
    } else {
      requestBlockId = _rbs.length - 1;
    }

    Data.RequestBlock storage rb = _rbs[requestBlockId];

    if (!_isExit) {
      rb.numEnter += 1;
    }

    // make new RequestBlock
    if (rb.submitted || rb.requestEnd - rb.requestStart + 1 == Data.MAX_REQUESTS()) {
      rb = _rbs[_rbs.length++];
      rb.requestStart = uint64(requestId);
    }

    rb.init();

    rb.requestEnd = uint64(requestId);

    if (_isTransfer) {
      rb.addRequest(r, r.toChildChainRequest(_to), requestId);
    } else {
      rb.addRequest(r, r.toChildChainRequest(requestableContracts[_to]), requestId);
    }
  }

  /**
   * @notice prepare to submit ORB. It prevents further new requests from
   * being included in the request blocks in the just next ORB epoch.
   */
  function _prepareToSubmitORB() internal {
    // delegate to epoch handler
    require(epochHandler.delegatecall(bytes4(keccak256("_prepareToSubmitORB()"))));
  }

  function _prepareToSubmitNRB() internal {
    // delegate to epoch handler
    require(epochHandler.delegatecall(bytes4(keccak256("_prepareToSubmitNRB()"))));
  }

  function prepareOREAfterURE() internal {
    // delegate to epoch handler
    require(epochHandler.delegatecall(bytes4(keccak256("prepareOREAfterURE()"))));
  }

  function prepareNREAfterURE() internal {
    // delegate to epoch handler
    require(epochHandler.delegatecall(bytes4(keccak256("prepareNREAfterURE()"))));
  }

  /**
   * @notice finalize a block if possible.
   */
  function _finalizeBlock() internal returns (bool) {
    // short circuit if waiting URBs
    if (forks[currentFork].forkedBlock != 0) {
      return false;
    }

    Data.Fork storage fork = forks[currentFork];
    uint blockNumber = Math.max(fork.firstBlock, fork.lastFinalizedBlock + 1);

    // short circuit if all blocks are submitted yet
    if (blockNumber > fork.lastBlock) {
      return false;
    }

    Data.PlasmaBlock storage pb = fork.blocks[blockNumber];

    // short circuit if the block is under challenge
    if (pb.challenging) {
      return false;
    }

    // 1. finalize request block
    if (pb.isRequest) {
      // short circuit if challenge period doesn't end
      if (pb.timestamp + CP_COMPUTATION > block.timestamp) {
        return false;
      }

      // finalize block
      _doFinalize(fork, pb, blockNumber);
      return true;
    }

    // 2. finalize non request block

    uint nextEpochNumber = pb.epochNumber + 1;

    // if the first block of the next request epoch is finalized, finalize all
    // blocks of the current non request epoch.
    if (_checkFinalizable(fork, nextEpochNumber)) {
      _doFinalizeEpoch(fork, pb.epochNumber);
      return true;
    }

    // short circuit if challenge period doesn't end
    if (pb.timestamp + CP_WITHHOLDING > block.timestamp) {
      return false;
    }

    // finalize block
    _doFinalize(fork, pb, blockNumber);
    return true;
  }

  /**
   * @notice return true if the first block of a request epoch (ORB epoch / URB epoch)
   *         can be finalized.
   */
  function _checkFinalizable(Data.Fork storage fork, uint _epochNumber) internal view returns (bool) {
    // cannot finalize future epoch
    if (_epochNumber > fork.lastEpoch) {
      return false;
    }

    Data.Epoch storage epoch = fork.epochs[_epochNumber];

    // cannot finalize if it is not request epoch
    if (!epoch.isRequest) {
      return false;
    }

    if (epoch.isEmpty) {
      // return if the epoch has ends challenge period
      return epoch.timestamp + CP_COMPUTATION > block.timestamp;
    }

    // cannot finalize if the first block was not submitted
    if (epoch.startBlockNumber > fork.lastBlock) {
      return false;
    }

    Data.PlasmaBlock storage pb = fork.blocks[epoch.startBlockNumber];

    // the block was already finalized
    if (pb.finalized) {
      return true;
    }

    // short circuit if the request block is under challenge
    if (pb.challenging) {
      return false;
    }

    // return if challenge period end
    return pb.timestamp + CP_COMPUTATION <= block.timestamp;
  }

  /**
   * @notice finalize a block
   */
  function _doFinalize(
    Data.Fork storage _f,
    Data.PlasmaBlock storage _pb,
    uint _blockNumber
  ) internal {
    _pb.finalized = true;
    _pb.finalizedAt = uint64(block.timestamp);
    _f.lastFinalizedBlock = uint64(_blockNumber);

    emit BlockFinalized(currentFork, _blockNumber);
  }

  /**
   * @notice finalize all blocks in the non request epoch
   */
  function _doFinalizeEpoch(
    Data.Fork storage _f,
    uint _epochNumber
  ) internal {
    Data.Epoch storage epoch = _f.epochs[_epochNumber];

    require(!epoch.isRequest);

    uint lastBlockNumber = epoch.startBlockNumber;
    for (; lastBlockNumber <= epoch.endBlockNumber; lastBlockNumber++) {
      Data.PlasmaBlock storage pb = _f.blocks[lastBlockNumber];

      // shrot circuit if block is under challenge or challenged
      if (pb.challenging || pb.challenged) {
        break;
      }

      pb.finalized = true;
      pb.finalizedAt = uint64(block.timestamp);
      // BlockFinalized event is not fired to reduce the gas cost.
    }

    lastBlockNumber = lastBlockNumber - 1;

    if (lastBlockNumber >= epoch.startBlockNumber) {
      _f.lastFinalizedBlock = uint64(lastBlockNumber);

      // a single EpochFinalized event replaces lots of BlockFinalized events.
      emit EpochFinalized(currentFork, _epochNumber, epoch.startBlockNumber, lastBlockNumber);
    }

    return;
  }
}
