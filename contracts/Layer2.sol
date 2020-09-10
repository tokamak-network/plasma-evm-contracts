pragma solidity ^0.5.12;
pragma experimental ABIEncoderV2;

import "./lib/SafeMath.sol";
import "./lib/Math.sol";
import "./lib/Data.sol";
import "./lib/Address.sol";
import "./lib/BMT.sol";
// import "./patricia_tree/PatriciaTreeFace.sol";

import "./roles/MapperRole.sol";
import "./roles/SubmitterRole.sol";

import "./Layer2Storage.sol";
import "./Layer2Event.sol";
import "./Layer2Base.sol";


contract Layer2 is Layer2Storage, Layer2Event, Layer2Base, MapperRole, SubmitterRole {
  using SafeMath for uint;
  using SafeMath for uint64;
  using Math for *;
  using Data for *;
  using Address for address;
  using BMT for *;

  /*
   * Modifiers
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

  modifier onlyOperatorOrSeigManager () {
    require(msg.sender == operator || msg.sender == seigManager);
    _;
  }

  /*
   * Constructor
   */
  constructor(
    address _epochHandler,
    address _submitHandler,
    address _etherToken,
    bool _development,
    uint _NRELength,

    // genesis block state
    bytes32 _statesRoot,
    bytes32 _transactionsRoot,
    bytes32 _receiptsRoot
  )
    public
  {
    require(_epochHandler.isContract());
    require(_submitHandler.isContract());
    require(_etherToken.isContract());

    epochHandler = _epochHandler;
    submitHandler = _submitHandler;
    etherToken = _etherToken;

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

    // prepare ORE#2
    fork.epochs[2].isEmpty = true;
    fork.epochs[2].isRequest = true;

    _doFinalizeBlock(fork, genesis, 0);
    _doFinalizeNRE(fork, 0);

    _delegatePrepareNRE();
  }

  /*
   * External Functions
   */

  function changeOperator(address _operator) external onlyOperatorOrSeigManager {
    operator = _operator;
    emit OperatorChanged(_operator);
  }

  function addSubmitter(address account) public onlyOperator {
    _addSubmitter(account);
  }

  function addMapper(address account) public onlyOperator {
    _addMapper(account);
  }

  function setSeigManager(address account) public onlyOperatorOrSeigManager {
    seigManager = account;
  }

  /**
   * @notice map requestable contract in child chain
   * NOTE: only operator?
   */
  function mapRequestableContractByOperator(address _layer2, address _childchain)
    external
    onlyMapper
    returns (bool success)
  {
    require(_layer2.isContract());
    require(requestableContracts[_layer2] == address(0));

    requestableContracts[_layer2] = _childchain;

    emit RequestableContractMapped(_layer2, _childchain);
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
    public
    payable
    onlyValidCost(COST_URB_PREPARE)
    // finalizeBlocks
  {
    // TODO: change to continuous rebase scheme.
    // disable UAF.
    revert();
    // return false;
    // Layer2Base.prepareToSubmitURB();
  }

  function submitNRE(
    uint _pos1, // forknumber + epochNumber
    uint _pos2, // startBlockNumber + endBlockNumber
    bytes32 _epochStateRoot,
    bytes32 _epochTransactionsRoot,
    bytes32 _epochReceiptsRoot
  )
    external
    payable
    onlySubmitter
    onlyValidCost(COST_NRB)
    finalizeBlocks
    returns (bool success)
  {
    return Layer2Base._delegateSubmitNRE(
      _pos1,
      _pos2,
      _epochStateRoot,
      _epochTransactionsRoot,
      _epochReceiptsRoot
    );
  }

  function submitORB(
    uint _pos,
    bytes32 _statesRoot,
    bytes32 _transactionsRoot,
    bytes32 _receiptsRoot
  )
    external
    payable
    onlySubmitter
    onlyValidCost(COST_NRB)
    finalizeBlocks
    returns (bool success)
  {
    return Layer2Base._delegateSubmitORB(
      _pos,
      _statesRoot,
      _transactionsRoot,
      _receiptsRoot
    );
  }

  function submitURB(
    uint _pos,
    bytes32 _statesRoot,
    bytes32 _transactionsRoot,
    bytes32 _receiptsRoot
  )
    external
    payable
    onlyValidCost(COST_URB)
    returns (bool success)
  {
    // TODO: change to continuous rebase scheme.
    // disable UAF.
    revert();
    return false;

    // return Layer2Base._delegateSubmitURB(
    //   _pos,
    //   _statesRoot,
    //   _transactionsRoot,
    //   _receiptsRoot
    // );
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
    bytes calldata _receiptData,
    bytes calldata _proof
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
    bytes memory _receiptData,
    bytes memory _proof
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

    return requestId;
  }

  /**
   * @notice It challenges on NRBs containing null address transaction.
   */
  function challengeNullAddress(
    uint _blockNumber,
    bytes calldata _key,
    bytes calldata _txByte, // RLP encoded transaction
    uint _branchMask,
    bytes32[] calldata  _siblings
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
    bytes memory _trieValue
  )
    public
    payable
    onlyValidCost(COST_ERO)
    returns (bool success)
  {
    uint requestId;
    requestId = _storeRequest(EROs, ORBs, _to, 0, _trieKey, _trieValue, true, false);

    emit RequestCreated(requestId, msg.sender, _to, 0, _trieKey, _trieValue, true, false);
    return true;
  }

  function startEnter(
    address _to,
    bytes32 _trieKey,
    bytes memory _trieValue
  )
    public
    payable
    returns (bool success)
  {
    uint requestId;
    uint weiAmount = msg.value;
    requestId = _storeRequest(EROs, ORBs, _to, weiAmount, _trieKey, _trieValue, false, false);
    numEnterForORB += 1;

    Data.Fork storage fork = forks[currentFork];

    emit RequestApplied(requestId, false);
    emit RequestCreated(requestId, msg.sender, _to, weiAmount, _trieKey, _trieValue, false, false);
    return true;
  }

  function makeERU(
    address _to,
    bytes32 _trieKey,
    bytes memory _trieValue
  )
    public
    payable
    onlyValidCost(COST_ERU)
    returns (bool success)
  {
    uint requestId;
    requestId = _storeRequest(ERUs, URBs, _to, 0, _trieKey, _trieValue, true, true);

    emit RequestCreated(requestId, msg.sender, _to, 0, _trieKey, _trieValue, true, true);
    return true;
  }

  /**
   * @notice Finalize a request if request block including it
   *         is finalized.
   * TODO: refactor implementation
   */
  function finalizeRequest() public returns (bool success) {
    uint requestId;
    Data.Fork storage fork = forks[lastAppliedForkNumber];
    uint epochNumber = lastAppliedEpochNumber;

    require(lastAppliedBlockNumber <= fork.lastBlock);

    Data.PlasmaBlock storage pb = fork.blocks[lastAppliedBlockNumber];
    Data.Epoch storage epoch = fork.epochs[epochNumber];

    // TODO: execute after finding next request block
    // find next fork
    if (fork.forkedBlock != 0 && lastAppliedBlockNumber >= fork.forkedBlock) {
      lastAppliedForkNumber += 1;
      fork = forks[lastAppliedForkNumber];

      epochNumber = fork.firstEpoch;
      epoch = fork.epochs[epochNumber];

      lastAppliedBlockNumber = fork.firstBlock;
      lastAppliedEpochNumber = epochNumber;

      pb = fork.blocks[lastAppliedBlockNumber];
    }

    // find next request block
    if (!pb.isRequest) {
      if (epochNumber == 0) {
        epochNumber = firstNonEmptyRequestEpoch[lastAppliedForkNumber];
      } else {
        epochNumber = fork.epochs[epochNumber].RE.nextEpoch;
      }
      require(epochNumber != 0);

      epoch = fork.epochs[epochNumber];
      lastAppliedBlockNumber = epoch.startBlockNumber;
      pb = fork.blocks[lastAppliedBlockNumber];
    } else {
      epochNumber = pb.epochNumber;
      epoch = fork.epochs[epochNumber];
    }

    lastAppliedEpochNumber = epochNumber;

    require(!epoch.isEmpty);
    require(epoch.isRequest);
    require(pb.isRequest);
    require(pb.finalized);
    require(pb.finalizedAt + CP_EXIT <= block.timestamp);

    // apply ERU
    if (pb.userActivated) {
      requestId = ERUIdToFinalize;

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

      ERUIdToFinalize = requestId + 1;

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
    requestId = EROIdToFinalize;

    require(EROs.length > requestId);

    Data.RequestBlock storage ORB = ORBs[pb.requestBlockId];

    require(ORB.requestStart <= requestId && requestId <= ORB.requestEnd);

    // check next block
    if (requestId == ORB.requestEnd) {
      // TODO: iterator blocks by NRE length for NRE'
      if (fork.forkedBlock > 0 && lastAppliedBlockNumber == fork.forkedBlock - 1) {
        lastAppliedForkNumber += 1;
      }

      lastAppliedBlockNumber += 1;
    }

    Data.Request storage ERO = EROs[requestId];
    EROIdToFinalize = requestId + 1;
    ERO.finalized = true;

    if (ERO.isExit && !ERO.challenged) {
      ERO.applyRequestInRootChain(requestId);
      ERO.requestor.transfer(COST_ERO);
      emit RequestApplied(requestId, false);
    }

    emit RequestFinalized(requestId, false);
    return true;
  }

  function finalizeRequests(uint n) external returns (bool success) {
    for (uint i = 0; i < n; i++) {
      require(finalizeRequest());
    }

    return true;
  }

  /**
   * @notice return the max number of request
   */
  function MAX_REQUESTS() external pure returns (uint maxRequests) {
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
  ) external view returns (
    Data.Epoch memory epoch
  ) {
    return forks[forkNumber].epochs[epochNumber];
  }

  function getLastEpoch() public view returns (Data.Epoch memory) {
    return forks[currentFork].epochs[forks[currentFork].lastEpoch];
  }

  function getBlock(
    uint forkNumber,
    uint blockNumber
  ) public view returns (Data.PlasmaBlock memory) {
    return forks[forkNumber].blocks[blockNumber];
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

  function getLastFinalizedEpoch(uint forkNumber) public view returns (uint) {
    return forks[forkNumber].lastFinalizedEpoch;
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
    address _to,
    uint _weiAmount,
    bytes32 _trieKey,
    bytes memory _trieValue,
    bool _isExit,
    bool _userActivated
  )
    internal
    returns (uint requestId)
  {
    // trieValue cannot be longer than 1KB.
    require(_trieValue.length <= 1024);

    bool isTransfer = _to == etherToken;

    // check parameters for simple ether transfer and message-call
    require(isTransfer && !_isExit || (requestableContracts[_to] != address(0)));

    requestId = _requests.length++;
    Data.Request storage r = _requests[requestId];

    r.requestor = msg.sender;
    r.to = _to;
    r.timestamp = uint64(block.timestamp);
    r.isExit = _isExit;
    r.isTransfer = isTransfer;
    r.value = uint128(_weiAmount);
    r.trieKey = _trieKey;
    r.trieValue = _trieValue;

    // apply message-call in case of enter request.
    if (!_isExit) {
      require(r.applyRequestInRootChain(requestId));
    }

    uint requestBlockId = _rbs.length == 0 ? _rbs.length++ : _rbs.length - 1;

    Data.RequestBlock storage rb = _rbs[requestBlockId];

    // make a new RequestBlock.
    if (rb.submitted || rb.requestEnd - rb.requestStart + 1 == Data.MAX_REQUESTS()) {
      rb.submitted = true;
      rb = _rbs[_rbs.length++];
      rb.requestStart = uint64(requestId);
    }

    rb.init();

    rb.requestEnd = uint64(requestId);
    if (!_isExit) {
      rb.numEnter += 1;
    }

    if (isTransfer && !_isExit) {
      rb.addRequest(r, r.toChildChainRequest(msg.sender), requestId);
    } else {
      rb.addRequest(r, r.toChildChainRequest(requestableContracts[_to]), requestId);
    }
  }

  /**
   * @notice finalize a block if possible.
   */
  function _finalizeBlock() internal returns (bool) {
    Data.Fork storage fork = forks[currentFork];

    // short circuit if waiting URBs
    if (fork.forkedBlock != 0) {
      return false;
    }

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
      _doFinalizeBlock(fork, pb, blockNumber);
      return true;
    }

    // 2. finalize non request epoch
    uint nextEpochNumber = fork.lastFinalizedEpoch + 1;
    while (fork.epochs[nextEpochNumber].isRequest) {
      nextEpochNumber += 1;
    }

    // if the first block of the next request epoch is finalized, finalize all
    // blocks of the current non request epoch.
    if (_checkFinalizableNRE(fork, nextEpochNumber)) {
      _doFinalizeNRE(fork, nextEpochNumber);
      return true;
    }

    return false;
  }

  /**
   * @notice return true if NRE can be finalized.
   */
  function _checkFinalizableNRE(Data.Fork storage fork, uint _epochNumber) internal view returns (bool) {
    // short circuit if epoch is not submitted yet
    if (_epochNumber > fork.lastEpoch) {
      return false;
    }

    Data.Epoch storage epoch = fork.epochs[_epochNumber];

    // short circuit if epoch is not initialized
    if (!epoch.initialized) {
      return false;
    }

    // short circuit if epoch is not NRE
    if (epoch.isRequest) {
      return false;
    }

    // short circuit if epoch is challenged or under challenge
    if (epoch.NRE.challenging || epoch.NRE.challenged) {
      return false;
    }

    // return if challenge period end
    return epoch.NRE.submittedAt + CP_WITHHOLDING <= block.timestamp;
    // return true;
  }

  /**
   * @notice finalize a block
   */
  function _doFinalizeBlock(
    Data.Fork storage _f,
    Data.PlasmaBlock storage _pb,
    uint _blockNumber
  ) internal {
    _pb.finalized = true;
    _pb.finalizedAt = uint64(block.timestamp);

    _f.lastFinalizedBlock = uint64(_blockNumber);
    _f.lastFinalizedEpoch = uint64(_pb.epochNumber);

    emit BlockFinalized(currentFork, _blockNumber);
  }

  /**
   * @notice finalize all blocks in the non request epoch
   */
  function _doFinalizeNRE(
    Data.Fork storage _f,
    uint _epochNumber
  ) internal {
    Data.Epoch storage epoch = _f.epochs[_epochNumber];

    epoch.NRE.finalized = true;
    epoch.NRE.finalizedAt = uint64(block.timestamp);

    _f.lastFinalizedBlock = uint64(epoch.endBlockNumber);
    _f.lastFinalizedEpoch = uint64(_epochNumber);

    // a single EpochFinalized event replaces lots of BlockFinalized events.
    emit EpochFinalized(currentFork, _epochNumber, epoch.startBlockNumber, epoch.endBlockNumber);

    return;
  }
}
