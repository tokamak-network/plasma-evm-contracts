pragma solidity ^0.4.24;

import "./lib/SafeMath.sol";
import "./lib/Math.sol";
import "./lib/Data.sol";
import "./lib/Address.sol";
import "./lib/BMT.sol";
import "./patricia_tree/PatriciaTreeFace.sol";


// TODO: use SafeMath
// TODO: remove state. use epoch.isRequest and epoch.userActivated
contract RootChain {
  using SafeMath for uint;
  using SafeMath for uint64;
  using Math for *;
  using Data for *;
  using Address for address;
  using BMT for *;

  /*
   * Storage
   */
  bool public development; // dev mode
  address public operator;

  // 1 epoch = N NRBs or k URBs or k ORBs.
  // N consecutive NRBs must be submitted in an epoch. In case of request block,
  // massive requests can be included in k ORBs, and k is determined when
  // N NRBs are submitted or when preparing URBs submission.
  uint public NRBEpochLength;

  // Increase for each URB
  uint public currentFork;

  // First not-empty request epochs of a fork
  mapping (uint => uint) public firstFilledORBEpochNumber;

  mapping (uint => Data.Fork) public forks;

  
  // Enter & Exit requests for ORB / URB
  Data.Request[] public EROs;
  Data.Request[] public ERUs;

  // Consecutive request block. The fork where they are in is defined in Data.PlasmaBlock
  Data.RequestBlock[] public ORBs;
  Data.RequestBlock[] public URBs;

  // Last applied request
  uint public lastAppliedForkNumber;
  uint public lastAppliedBlockNumber;
  uint public lastAppliedERO;
  uint public lastAppliedERU;

  // Requestable contract address in child chain
  mapping (address => address) public requestableContracts;

  /*
   * Constant
   */
  address constant public NULL_ADDRESS = 0x0000000000000000000000000000000000000000;

  // TODO: develop cost function model
  // Simple cost parameters
  uint public constant COST_ERO = 0.1 ether;         // cost for invalid exit
  uint public constant COST_ERU = 0.2 ether;         // cost for fork & rebase
  uint public constant COST_URB_PREPARE = 0.1 ether; // cost for URB prepare
  uint public constant COST_URB = 0.9 ether;         // cost for fork & rebase
  uint public constant COST_ORB = 0.1 ether;         // cost for invalid computation
  uint public constant COST_NRB = 0.1 ether;         // cost for invalid computation

  // Prepare time
  uint public constant PREPARE_TIMEOUT = 1 hours;

  // Challenge periods for computation and withholding
  // uint public constant CP_COMPUTATION = 1 days;
  // uint public constant CP_WITHHOLDING = 7 days;
  uint public constant CP_COMPUTATION = 1; // 1 sec for dev
  uint public constant CP_WITHHOLDING = 3; // 3 sec for dev

  
  // Gas limit for request trasaction
  uint public constant REQUEST_GAS = 100000;

  /*
   * Event
   */
  event SessionTimeout(bool userActivated);

  event Forked(uint newFork, uint forkedBlockNumber);
  event EpochPrepared(
    uint epochNumber,
    uint startBlockNumber,
    uint endBlockNumber,
    uint requestStart,
    uint requestEnd,
    bool epochIsEmpty,
    bool isRequest,
    bool userActivated
  );

  event NRBSubmitted(uint fork, uint blockNumber);
  event ORBSubmitted(uint fork, uint blockNumber);
  event URBSubmitted(uint fork, uint blockNumber);

  event RequestCreated(
    uint requestId,
    address requestor,
    address to,
    uint weiAmount,
    bytes32 trieKey,
    bytes32 trieValue,
    bool isTransfer,
    bool isExit,
    bool userActivated
  );
  event ERUCreated(
    uint requestId,
    address requestor,
    address to,
    bytes32 trieKey,
    bytes32 trieValue
  );

  event BlockFinalized(uint forkNumber, uint blockNumber);
  event EpochFinalized(
    uint forkNumber,
    uint epochNumber,
    uint startBlockNumber,
    uint endBlockNumber
  );

  // emit when exit is finalized. _userActivated is true for ERU
  event RequestFinalized(uint requestId, bool userActivated);
  event RequestApplied(uint requestId, bool userActivated);
  event RequestChallenged(uint requestId, bool userActivated);

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
    _finalizeBlock();
    _;
  }

  /*
   * Constructor
   */
  constructor(
    bool _development,
    uint _NRBEpochLength,

    // genesis block state
    bytes32 _statesRoot,
    bytes32 _transactionsRoot,
    bytes32 _receiptsRoot
  )
    public
  {
    development = _development;
    operator = msg.sender;
    NRBEpochLength = _NRBEpochLength;

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
    finalizeBlocks
    returns (bool success)
  {    
    return true;
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
    Data.Fork storage fork = forks[_forkNumber];

    uint epochNunber;
    uint blockNumber;
    
    (epochNunber, blockNumber) = fork.insertBlock(
      _statesRoot,
      _transactionsRoot,
      _receiptsRoot,
      false,
      false
    );

    emit NRBSubmitted(currentFork, blockNumber);

    if (blockNumber == fork.epochs[fork.lastEpoch].endBlockNumber) {
      _prepareToSubmitORB();
    }

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
    Data.Fork storage fork = forks[_forkNumber];

    fork.insertBlock(
      _statesRoot,
      _transactionsRoot,
      _receiptsRoot,
      true,
      false
    );

    if (!development) {
      _transactionsRoot._checkTxRoot(
        ORBs[fork.blocks[fork.lastBlock].requestBlockId],
        EROs,
        false
      );
    }

    emit ORBSubmitted(currentFork, fork.lastBlock);

    if (fork.lastBlock == fork.epochs[fork.lastEpoch].endBlockNumber) {
      _prepareToSubmitNRB();
    }

    return true;
  }

  // TODO: use Data.Fork
  function submitURB(
    bytes32 _statesRoot,
    bytes32 _transactionsRoot,
    bytes32 _receiptsRoot
  )
    external
    payable
    onlyValidCost(COST_URB)
    returns (bool success)
  {
    // bool firstURB = !fork.blocks[highestBlockNumber[currentFork]].isRequest;

    // uint blockNumber = _storeBlock(
    //   _statesRoot,
    //   _transactionsRoot,
    //   _receiptsRoot,
    //   true,
    //   true,
    //   firstURB
    // );

    // if (blockNumber != 0) {
    //   Data.Epoch storage epoch = fork.epochs[currentEpoch];
    //   uint numBlocks = epoch.getNumBlocks();
    //   uint submittedURBs = highestBlockNumber[currentFork] - epoch.startBlockNumber + 1;

    //   // TODO: verify transactionsRoot

    //   if (submittedURBs == numBlocks) {
    //     _prepareToSubmitNRB();
    //   }

    //   emit ORBSubmitted(currentFork, blockNumber);
    //   return true;
    // }

    return false;
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

    bytes32 leaf = keccak256(_receiptData);

    require(_receiptData.toReceiptStatus() == 0);
    if (!development) {
      require(BMT.checkMembership(leaf, _index, _pb.receiptsRoot, _proof));
    }

    Data.Request storage r = _rs[requestId];
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

    PatriciaTreeFace trie;
    if (pb.userActivated) {
      trie = PatriciaTreeFace(URBs[pb.requestBlockId].trie);
    } else {
      trie = PatriciaTreeFace(ORBs[pb.requestBlockId].trie);
    }

    Data.TX memory txData = Data.toTX(_txByte);
    require(txData.isNATX());

    // TODO: use patricia verify library
    require(trie.verifyProof(pb.transactionsRoot, _key, _txByte, _branchMask, _siblings));

    // TODO: fork? penalize?
  }

  /*
   * Public Functions
   */
  function startExit(
    address _to,
    uint _value,
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
    uint weiAmount = _value;
    requestId = _storeRequest(EROs, ORBs, false, _to, weiAmount, _trieKey, _trieValue, true, false);

    emit RequestCreated(requestId, msg.sender, _to, weiAmount, _trieKey, _trieValue, false, true, false);
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

    emit RequestApplied(requestId, false);
    emit RequestCreated(requestId, msg.sender, _to, weiAmount, _trieKey, _trieValue, _isTransfer, false, false);
    return true;
  }

  function makeERU(
    bool _isTransfer,
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
    uint weiAmount = msg.value - COST_ERU;
    requestId = _storeRequest(ERUs, URBs, _isTransfer, _to, weiAmount, _trieKey, _trieValue, true, true);

    emit RequestCreated(requestId, msg.sender, _to, weiAmount, _trieKey, _trieValue, _isTransfer, true, true);
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

    Data.Epoch storage epoch = fork.epochs[pb.epochNumber];

    // find next request block
    if (!pb.isRequest) {
      while (!fork.epochs[epochNumber].isRequest) {
        require(fork.epochs[epochNumber].initialized);
        epochNumber = epochNumber + 1;
      }

      lastAppliedBlockNumber = epoch.startBlockNumber;

      epoch = fork.epochs[epochNumber];
      pb = fork.blocks[lastAppliedBlockNumber];
    }

    require(pb.finalized);

    // apply ERU
    if (pb.userActivated) {
      requestId = lastAppliedERU;

      require(ERUs.length > requestId);

      Data.Request storage ERU = ERUs[requestId];
      Data.RequestBlock storage URB = URBs[pb.requestBlockId];

      // check next block
      if (requestId == URB.requestEnd) {
        if (epoch.forkedBlockNumber > 0 && lastAppliedBlockNumber == epoch.forkedBlockNumber - 1) {
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

    // check next block
    if (requestId == ORB.requestEnd) {
      if (epoch.forkedBlockNumber > 0 && lastAppliedBlockNumber == epoch.forkedBlockNumber - 1) {
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
    uint64 forkedBlockNumber,
    uint64 firstRequestBlockId,
    uint64 timestamp,
    bool isEmpty,
    bool initialized,
    bool isRequest,
    bool userActivated
  ) {
    Data.Epoch storage epoch = forks[forkNumber].epochs[epochNumber];

    requestStart = epoch.requestStart;
    requestEnd = epoch.requestEnd;
    startBlockNumber = epoch.startBlockNumber;
    endBlockNumber = epoch.endBlockNumber;
    forkedBlockNumber = epoch.forkedBlockNumber;
    firstRequestBlockId = epoch.firstRequestBlockId;
    timestamp = epoch.timestamp;
    isEmpty = epoch.isEmpty;
    initialized = epoch.initialized;
    isRequest = epoch.isRequest;
    userActivated = epoch.userActivated;

    return;
  }

  function getBlock(
    uint forkNumber,
    uint blockNumber
  ) public view returns (
    uint64 epochNumber,
    uint64 previousBlockNumber,
    uint64 requestBlockId,
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
    previousBlockNumber = forks[forkNumber].blocks[blockNumber].previousBlockNumber;
    requestBlockId = forks[forkNumber].blocks[blockNumber].requestBlockId;
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

    if (_isExit) {
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
    Data.Fork storage fork = forks[currentFork];
    fork.lastEpoch += 1;
    Data.Epoch storage epoch = fork.epochs[fork.lastEpoch];

    epoch.startBlockNumber = fork.epochs[fork.lastEpoch - 1].endBlockNumber + 1;

    epoch.isRequest = true;
    epoch.initialized = true;
    epoch.timestamp = uint64(block.timestamp);

    _checkPreviousORBEpoch(epoch);

    if (epoch.isEmpty) {
      epoch.requestEnd = epoch.requestStart;
      epoch.startBlockNumber = epoch.startBlockNumber.sub64(1);
      epoch.endBlockNumber = epoch.startBlockNumber;
    } else {
      epoch.requestEnd = uint64(EROs.length - 1);
      epoch.endBlockNumber = uint64(epoch.startBlockNumber + uint(epoch.requestEnd - epoch.requestStart + uint64(1))
        .divCeil(Data.MAX_REQUESTS()) - 1);
    }

    emit EpochPrepared(
      fork.lastEpoch,
      epoch.startBlockNumber,
      epoch.endBlockNumber,
      epoch.requestStart,
      epoch.requestEnd,
      epoch.isEmpty,
      true,
      false
    );

    // no ORB to submit
    if (epoch.isEmpty) {
      _prepareToSubmitNRB();
    } else {
      uint numBlocks = epoch.getNumBlocks();
      for (uint64 i = 0; i < numBlocks; i++) {
        fork.blocks[epoch.startBlockNumber.add64(i)].isRequest = true;
        fork.blocks[epoch.startBlockNumber.add64(i)].requestBlockId = epoch.firstRequestBlockId + i;
      }
    }
  }

  function _checkPreviousORBEpoch(Data.Epoch storage epoch) internal {
    // short circuit if there is no request at all
    if (EROs.length == 0) {
      epoch.isEmpty = true;
      return;
    }

    Data.Fork storage fork = forks[currentFork];
    Data.Epoch storage previousRequestEpoch = fork.epochs[fork.lastEpoch - 2];

    if (EROs.length - 1 == uint(previousRequestEpoch.requestEnd)) {
      epoch.isEmpty = true;
    }

    // short circuit because epoch#0(previousRequestEpoch) is not a request epoch
    if (currentFork == 2) {
      return;
    }

    if (epoch.isEmpty) {
      epoch.requestStart = previousRequestEpoch.requestEnd;

      if (previousRequestEpoch.isEmpty) {
        epoch.firstRequestBlockId = previousRequestEpoch.firstRequestBlockId;
      } else {
        epoch.firstRequestBlockId = previousRequestEpoch.firstRequestBlockId + uint64(previousRequestEpoch.getNumBlocks());
      }
    } else {
      // if there is no filled ORB epoch, this is the first one
      if (firstFilledORBEpochNumber[currentFork] == 0) {
        firstFilledORBEpochNumber[currentFork] = fork.lastEpoch;
      } else {
        // set requestStart, firstRequestBlockId based on previousRequestEpoch
        if (previousRequestEpoch.isEmpty) {
          epoch.requestStart = previousRequestEpoch.requestEnd;
          epoch.firstRequestBlockId = previousRequestEpoch.firstRequestBlockId;
        } else {
          epoch.requestStart = previousRequestEpoch.requestEnd + 1;
          epoch.firstRequestBlockId = previousRequestEpoch.firstRequestBlockId + uint64(previousRequestEpoch.getNumBlocks());
        }
      }
    }

    // seal last ORB
    if (ORBs.length > 0) {
      ORBs[ORBs.length.sub(1)].submitted = true;
    }
  }


  function _prepareToSubmitNRB() internal {
    Data.Fork storage fork = forks[currentFork];
    fork.lastEpoch += 1;
    Data.Epoch storage epoch = fork.epochs[fork.lastEpoch];

    uint startBlockNumber = 1;

    if (fork.lastEpoch != 1) {
      startBlockNumber = fork.epochs[fork.lastEpoch - 1].endBlockNumber + 1;
    }

    epoch.initialized = true;
    epoch.timestamp = uint64(block.timestamp);

    epoch.startBlockNumber = uint64(startBlockNumber);
    epoch.endBlockNumber = uint64(startBlockNumber + NRBEpochLength - 1);

    emit EpochPrepared(
      fork.lastEpoch,
      epoch.startBlockNumber,
      epoch.endBlockNumber,
      0,
      0,
      false,
      false,
      false
    );
  }

  function _prepareToSubmitURB() internal {
    // // NOTE: what if no finalized block at this fork? consider URB re-submission

    // uint lastBlockNumber = lastFinalizedBlock[currentFork];
    // Data.PlasmaBlock storage lastBlock = fork.blocks[lastBlockNumber];

    // uint nextFork = currentFork + 1;
    // uint forkEpochNumber = lastBlock.epochNumber;

    // // note epoch number for the new fork
    // firstEpoch[nextFork] = forkEpochNumber;

    // Data.Epoch storage epoch = epochs[nextFork][forkEpochNumber];

    // if (nextFork == 1) {
    //   // first URB fork
    //   epoch.requestStart = 0;
    // } else {
    //   // last ERU id of previous URB fork + 1
    //   epoch.requestStart = fork.epochs[firstEpoch[currentFork]].requestEnd + 1;
    // }

    // epoch.isRequest = true;
    // epoch.userActivated = true;
    // epoch.timestamp = uint64(block.timestamp);
    // epoch.requestEnd = uint64(ERUs.length.sub(1));
    // epoch.startBlockNumber = uint64(lastBlockNumber + 1);
    // epoch.endBlockNumber = uint64(epoch.startBlockNumber + uint(epoch.requestEnd - epoch.requestStart + 1)
    //   .divCeil(Data.MAX_REQUESTS()) - 1);
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
    uint blockNumber = fork.lastFinalizedBlock + 1;

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
