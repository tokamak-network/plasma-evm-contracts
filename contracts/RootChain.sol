pragma solidity ^0.4.24;

import "./lib/SafeMath.sol";
import "./lib/Math.sol";
import "./lib/Data.sol";
import "./lib/Address.sol";
import "./lib/BMT.sol";
import "./patricia_tree/PatriciaTreeFace.sol";


// TODO: use SafeMath
contract RootChain {
  using SafeMath for uint;
  using Math for *;
  using Data for *;
  using Address for address;
  using BMT for *;

  enum State {
    AcceptingNRB,
    AcceptingORB,
    // TODO: remove AcceptingURB
    AcceptingURB
  }

  /*
   * Storage
   */
  bool public development = true; // dev mode
  address public operator;
  State public state;

  // Increase for each URB
  uint public currentFork;

  // First epoch of a fork
  mapping (uint => uint) public firstEpoch;

  // First not-empty request epochs of a fork
  mapping (uint => uint) public firstFilledORBEpochNumber;

  // Increase for each epoch
  uint public currentEpoch;

  // Highest block number of the fork
  mapping (uint => uint) public highestBlockNumber;

  // fork => block number
  mapping (uint => uint) public lastFinalizedBlock;

  // fork => block number => PlasmaBlock
  mapping (uint => mapping (uint => Data.PlasmaBlock)) public blocks;

  // fork => epoch number => Epoch
  mapping (uint => mapping (uint => Data.Epoch)) public epochs;

  // 1 epoch = N NRBs or k URBs or k ORBs.
  // N consecutive NRBs must be submitted in an epoch. In case of request block,
  // massive requests can be included in k ORBs, and k is determined when
  // N NRBs are submitted or when preparing URBs submission.
  uint public NRBEpochLength;

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

  // How many requests can be included in a single request block
  uint public constant MAX_REQUESTS = 1000;

  // Gas limit for request trasaction
  uint public constant REQUEST_GAS = 100000;

  /*
   * Event
   */
  event SessionTimeout(bool userActivated);
  event StateChanged(State state);

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
    uint firstBlockNumber,
    uint lastBlockNumber
  );

  // emit when exit is finalized. _userActivated is true for ERU
  event RequestFinalized(uint requestId, bool userActivated);

  /*
   * Modifier
   */
  modifier onlyOperator() {
    require(msg.sender == operator);
    _;
  }

  modifier onlyState(State _state) {
    require(state == _state);
    _;
  }

  modifier onlyNotState(State _state) {
    require(state != _state);
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

    Data.PlasmaBlock storage genesis = blocks[currentFork][0];
    genesis.statesRoot = _statesRoot;
    genesis.transactionsRoot = _transactionsRoot;
    genesis.receiptsRoot = _receiptsRoot;

    // set up the genesis epoch
    epochs[0][0].timestamp = uint64(block.timestamp);
    epochs[0][0].isEmpty = false;
    epochs[0][0].initialized = true;
    epochs[0][0].finalized = true;

    _doFinalize(genesis, 0);
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
    onlyOperator
    onlyNotState(State.AcceptingURB)
    // finalizeBlocks
    returns (bool success)
  {
    state = State.AcceptingURB;
    _prepareToSubmitURB();
    return true;
  }

  // TODO: Delegate the validity check to TrueBit Verification Game contracts
  function submitNRB(
    bytes32 _statesRoot,
    bytes32 _transactionsRoot,
    bytes32 _receiptsRoot
  )
    external
    payable
    onlyOperator
    onlyState(State.AcceptingNRB)
    onlyValidCost(COST_NRB)
    finalizeBlocks
    returns (bool success)
  {
    Data.Epoch storage epoch = epochs[currentFork][currentEpoch];

    require(!epoch.isRequest);

    uint blockNumber = _storeBlock(
      _statesRoot,
      _transactionsRoot,
      _receiptsRoot,
      false,
      false,
      false
    );

    emit NRBSubmitted(currentFork, blockNumber);

    if (blockNumber == epoch.endBlockNumber) {
      _prepareToSubmitORB();
    }

    return true;
  }


  function submitORB(
    bytes32 _statesRoot,
    bytes32 _transactionsRoot,
    bytes32 _receiptsRoot
  )
    external
    payable
    onlyOperator
    onlyState(State.AcceptingORB)
    onlyValidCost(COST_ORB)
    finalizeBlocks
    returns (bool success)
  {
    Data.Epoch storage epoch = epochs[currentFork][currentEpoch];

    require(epoch.isRequest);

    uint blockNumber = _storeBlock(
      _statesRoot,
      _transactionsRoot,
      _receiptsRoot,
      true,
      false,
      false
    );

    emit ORBSubmitted(currentFork, blockNumber);

    if (!development) {
      Data.RequestBlock storage ORB = ORBs[blocks[currentFork][blockNumber].requestBlockId];
      uint s = ORB.requestStart;
      uint e = ORB.requestEnd;

      bytes32[] memory hashes = new bytes32[](e - s + 1);
      for (uint i = s; i <= e; i++) {
        hashes[i - s] = EROs[i].hash;
      }

      require(hashes.getRoot() == _transactionsRoot);

      /* use binary merkle tree instead of patricia tree
      Data.RequestBlock storage ORB = ORBs[blocks[currentFork][blockNumber].requestBlockId];
      require(_transactionsRoot == ORB.transactionsRoot);
       */
    }

    if (blockNumber == epoch.endBlockNumber) {
      _prepareToSubmitNRB();
    }

    return true;
  }

  function submitURB(
    bytes32 _statesRoot,
    bytes32 _transactionsRoot,
    bytes32 _receiptsRoot
  )
    external
    payable
    onlyState(State.AcceptingURB)
    onlyValidCost(COST_URB)
    returns (bool success)
  {
    bool firstURB = !blocks[currentFork][highestBlockNumber[currentFork]].isRequest;

    uint blockNumber = _storeBlock(
      _statesRoot,
      _transactionsRoot,
      _receiptsRoot,
      true,
      true,
      firstURB
    );

    if (blockNumber != 0) {
      Data.Epoch storage epoch = epochs[currentFork][currentEpoch];
      uint numBlocks = epoch.getNumBlocks();
      uint submittedURBs = highestBlockNumber[currentFork] - epoch.startBlockNumber + 1;

      // TODO: verify transactionsRoot

      if (submittedURBs == numBlocks) {
        _prepareToSubmitNRB();
      }

      emit ORBSubmitted(currentFork, blockNumber);
      return true;
    }

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
    bytes _receiptProof
  ) external {
    Data.PlasmaBlock storage pb = blocks[_forkNumber][_blockNumber];
    require(pb.isRequest);
    require(pb.finalized);

    if (pb.userActivated) {
      _doChallengeExit(pb, URBs[pb.requestBlockId], ERUs, _index, _receiptData, _receiptProof);
      // TODO: dynamic cost for ERU
      msg.sender.transfer(COST_ERU);
    } else {
      _doChallengeExit(pb, ORBs[pb.requestBlockId], EROs,_index, _receiptData, _receiptProof);
      msg.sender.transfer(COST_ERO);
    }
  }

  function _doChallengeExit(
    Data.PlasmaBlock storage _pb,
    Data.RequestBlock storage _rb,
    Data.Request[] storage _rs,
    uint _index,
    bytes _receiptData,
    bytes _proof
  ) internal {
    uint requestId = _rb.requestStart + _index;
    require(requestId <= _rb.requestEnd);

    bytes32 leaf = keccak256(_receiptData);

    require(_receiptData.toReceiptStatus() == 1);
    require(BMT.checkMembership(leaf, _index, _pb.receiptsRoot, _proof));

    Data.Request storage r = _rs[requestId];
    r.challenged = true;
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
    Data.PlasmaBlock storage pb = blocks[currentFork][_blockNumber];

    // check if the plasma block is NRB
    require(!pb.isRequest);

    // check if challenge period ends
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
    bool _isTransfer,
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
    uint requestId;
    uint weiAmount = _value;
    requestId = _storeRequest(EROs, ORBs, _isTransfer, _to, weiAmount, _trieKey, _trieValue, true, false);

    emit RequestCreated(requestId, msg.sender, _to, weiAmount, _trieKey, _trieValue, _isTransfer, true, false);
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
    uint forkNumber = lastAppliedForkNumber;
    uint epochNumber;
    uint blockNumber = lastAppliedBlockNumber;
    uint requestId;

    require(blockNumber <= highestBlockNumber[forkNumber]);

    Data.PlasmaBlock storage pb = blocks[forkNumber][blockNumber];
    epochNumber = pb.epochNumber;

    Data.Epoch storage epoch = epochs[forkNumber][pb.epochNumber];

    // find next request block
    if (!pb.isRequest) {
      while (!epochs[forkNumber][epochNumber].isRequest) {
        require(epochs[forkNumber][epochNumber].initialized);
        epochNumber = epochNumber + 1;
      }

      blockNumber = epoch.startBlockNumber;

      epoch = epochs[forkNumber][epochNumber];
      pb = blocks[forkNumber][blockNumber];
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
        if (epoch.forkedBlockNumber > 0 && blockNumber == epoch.forkedBlockNumber - 1) {
          lastAppliedForkNumber = forkNumber + 1;
        }

        lastAppliedBlockNumber = blockNumber + 1;
      }

      lastAppliedERU = requestId + 1;

      if (ERU.isExit) {
        // NOTE: do not check it reverted or not?
        ERU.applyRequestInRootChain(requestId);
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
      if (epoch.forkedBlockNumber > 0 && blockNumber == epoch.forkedBlockNumber - 1) {
        lastAppliedForkNumber = forkNumber + 1;
      }

      lastAppliedBlockNumber = blockNumber + 1;
    }

    lastAppliedERO = requestId + 1;

    if (ERO.isExit) {
      // NOTE: do not check it reverted or not?
      ERO.applyRequestInRootChain(requestId);
    }
    ERO.finalized = true;

    emit RequestFinalized(requestId, false);
    return true;
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
  function _storeBlock(
    bytes32 _statesRoot,
    bytes32 _transactionsRoot,
    bytes32 _receiptsRoot,
    bool _isRequest,
    bool _userActivated,
    bool _firstURB
  )
    internal
    returns (uint blockNumber)
  {
    // when first URB is submitted
    if (_isRequest && _userActivated && _firstURB) {
      uint nextFork = currentFork.add(1);
      uint forkEpochNumber = firstEpoch[nextFork];

      // newEpoch is already set up in preparing step
      Data.Epoch storage newEpoch = epochs[nextFork][forkEpochNumber];

      // URB submission is out of time
      if (newEpoch.isRequest && newEpoch.timestamp + PREPARE_TIMEOUT < block.timestamp) {
        delete epochs[nextFork][forkEpochNumber];
        firstEpoch[nextFork] = 0;
        return;
      }

      // update storage
      currentFork = nextFork;
      blockNumber = epochs[currentFork][firstEpoch[nextFork]].startBlockNumber;
      epochs[currentFork - 1][forkEpochNumber].forkedBlockNumber = uint64(blockNumber);

      emit Forked(nextFork, blockNumber);
    } else {
      blockNumber = highestBlockNumber[currentFork].add(1);
    }

    Data.PlasmaBlock storage b = blocks[currentFork][blockNumber];

    b.statesRoot = _statesRoot;
    b.transactionsRoot = _transactionsRoot;
    b.receiptsRoot = _receiptsRoot;
    b.timestamp = uint64(block.timestamp);
    b.epochNumber = uint64(currentEpoch);
    b.isRequest = _isRequest;
    b.userActivated = _userActivated;

    highestBlockNumber[currentFork] = blockNumber;
    return;
  }

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
    assert(_isTransfer || (requestableContracts[_to] != address(0)));

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
      assert(r.applyRequestInRootChain(requestId));
    }

    uint requestBlockId;
    if (_rbs.length == 0) {
      _rbs.length++;
      requestBlockId = 0;
    } else {
      requestBlockId = _rbs.length - 1;
    }

    Data.RequestBlock storage rb = _rbs[requestBlockId];

    // make new RequestBlock
    if (rb.submitted || rb.requestEnd - rb.requestStart + 1 == MAX_REQUESTS) {
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
    currentEpoch += 1;
    Data.Epoch storage epoch = epochs[currentFork][currentEpoch];

    epoch.startBlockNumber = epochs[currentFork][currentEpoch - 1].endBlockNumber + 1;

    epoch.isRequest = true;
    epoch.initialized = true;
    epoch.timestamp = uint64(block.timestamp);

    _checkPreviousORBEpoch(epoch);

    if (epoch.isEmpty) {
      epoch.requestEnd = epoch.requestStart;
      epoch.startBlockNumber = epoch.startBlockNumber - uint64(1);
      epoch.endBlockNumber = epoch.startBlockNumber;
    } else {
      epoch.requestEnd = uint64(EROs.length - 1);
      epoch.endBlockNumber = uint64(epoch.startBlockNumber + uint(epoch.requestEnd - epoch.requestStart + uint64(1))
        .divCeil(MAX_REQUESTS) - 1);
    }

    // change state to accept ORBs
    state = State.AcceptingORB;
    emit StateChanged(state);
    emit EpochPrepared(
      currentEpoch,
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
        blocks[currentFork][epoch.startBlockNumber + i].isRequest = true;
        blocks[currentFork][epoch.startBlockNumber + i].requestBlockId = epoch.firstRequestBlockId + i;
      }
    }
  }

  function _checkPreviousORBEpoch(Data.Epoch storage epoch) internal {
    // short circuit if there is no request at all
    if (EROs.length == 0) {
      epoch.isEmpty = true;
      return;
    }

    Data.Epoch storage previousRequestEpoch = epochs[currentFork][currentEpoch - 2];

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
        firstFilledORBEpochNumber[currentFork] = currentEpoch;
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
      ORBs[ORBs.length - 1].submitted = true;
    }
  }


  function _prepareToSubmitNRB() internal {
    currentEpoch += 1;
    Data.Epoch storage epoch = epochs[currentFork][currentEpoch];

    uint startBlockNumber = 1;

    if (currentEpoch != 1) {
      startBlockNumber = epochs[currentFork][currentEpoch - 1].endBlockNumber + 1;
    }

    epoch.initialized = true;
    epoch.startBlockNumber = uint64(startBlockNumber);
    epoch.endBlockNumber = uint64(startBlockNumber + NRBEpochLength - 1);
    epoch.timestamp = uint64(block.timestamp);

    // change state to accept NRBs
    state = State.AcceptingNRB;
    emit StateChanged(state);
    emit EpochPrepared(
      currentEpoch,
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
    // NOTE: what if no finalized block at this fork? consider URB re-submission

    uint lastBlockNumber = lastFinalizedBlock[currentFork];
    Data.PlasmaBlock storage lastBlock = blocks[currentFork][lastBlockNumber];

    uint nextFork = currentFork + 1;
    uint forkEpochNumber = lastBlock.epochNumber;

    // note epoch number for the new fork
    firstEpoch[nextFork] = forkEpochNumber;

    Data.Epoch storage epoch = epochs[nextFork][forkEpochNumber];

    if (nextFork == 1) {
      // first URB fork
      epoch.requestStart = 0;
    } else {
      // last ERU id of previous URB fork + 1
      epoch.requestStart = epochs[currentFork][firstEpoch[currentFork]].requestEnd + 1;
    }

    epoch.isRequest = true;
    epoch.userActivated = true;
    epoch.timestamp = uint64(block.timestamp);
    epoch.requestEnd = uint64(ERUs.length.sub(1));
    epoch.startBlockNumber = uint64(lastBlockNumber + 1);
    epoch.endBlockNumber = uint64(epoch.startBlockNumber + uint(epoch.requestEnd - epoch.requestStart + 1).divCeil(MAX_REQUESTS) - 1);
  }

  /**
   * @notice finalize a block if possible.
   */
  function _finalizeBlock() internal returns (bool) {
    // short circuit if waiting URBs
    if(state == State.AcceptingURB) {
      return false;
    }

    uint blockNumber = lastFinalizedBlock[currentFork] + 1;

    // short circuit if all blocks are submitted yet
    if (blockNumber > highestBlockNumber[currentFork]) {
      return false;
    }

    Data.PlasmaBlock storage pb = blocks[currentFork][blockNumber];

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
      _doFinalize(pb, blockNumber);
      return true;
    }

    // 2. finalize non request block

    uint nextEpochNumber = pb.epochNumber + 1;

    // if the first block of the next request epoch is finalized, finalize all
    // blocks of the current non request epoch.
    if (_checkFinalizable(nextEpochNumber)) {
      _doFinalizeEpoch(pb.epochNumber);
      return true;
    }

    // short circuit if challenge period doesn't end
    if (pb.timestamp + CP_WITHHOLDING > block.timestamp) {
      return false;
    }

    // finalize block
    _doFinalize(pb, blockNumber);
    return true;
  }

  /**
   * @notice return true if the first block of a request epoch (ORB epoch / URB epoch)
   *         can be finalized.
   */
  function _checkFinalizable(uint _epochNumber) internal view returns (bool) {
    // cannot finalize future epoch
    if (_epochNumber > currentEpoch) {
      return false;
    }

    Data.Epoch storage epoch = epochs[currentFork][_epochNumber];

    // cannot finalize if it is not request epoch
    if (!epoch.isRequest) {
      return false;
    }

    if (epoch.isEmpty) {
      // return if the epoch has ends challenge period
      return epoch.timestamp + CP_COMPUTATION > block.timestamp;
    }

    // cannot finalize if the first block was not submitted
    if (epoch.startBlockNumber > highestBlockNumber[currentFork]) {
      return false;
    }

    Data.PlasmaBlock storage pb = blocks[currentFork][epoch.startBlockNumber];

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
  function _doFinalize(Data.PlasmaBlock storage _pb, uint _blockNumber) internal {
    _pb.finalized = true;
    lastFinalizedBlock[currentFork] = _blockNumber;

    emit BlockFinalized(currentFork, _blockNumber);
  }

  /**
   * @notice finalize all blocks in the non request epoch
   */
  function _doFinalizeEpoch(uint _epochNumber) internal {
    Data.Epoch storage epoch = epochs[currentFork][_epochNumber];

    /* require(!epoch.isRequest); */

    uint i;
    bool stopped;
    for(i = epoch.startBlockNumber; i <= epoch.endBlockNumber; i++) {
      Data.PlasmaBlock storage pb = blocks[currentFork][i];

      // shrot circuit if block is under challenge or challenged
      if (pb.challenging || pb.challenged) {
        stopped = true;
        break;
      }

      pb.finalized = true;
      // BlockFinalized event is not fired to reduce the gas cost.
    }

    uint lastBlockNumber = stopped ? i - 1 : i;

    if (lastBlockNumber >= epoch.startBlockNumber) {
      lastFinalizedBlock[currentFork] = lastBlockNumber;

      // a single EpochFinalized event replaces lots of BlockFinalized events.
      emit EpochFinalized(currentFork, _epochNumber, epoch.startBlockNumber, lastBlockNumber);
    }

    return;
  }
}
