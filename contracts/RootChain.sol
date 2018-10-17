pragma solidity ^0.4.24;

import "./lib/SafeMath.sol";
import "./lib/Math.sol";
import "./lib/Data.sol";
import "./lib/Address.sol";
import "./patricia_tree/PatriciaTreeFace.sol";


// TODO: use SafeMath
contract RootChain {
  using SafeMath for uint;
  using Math for *;
  using Data for *;
  using Address for address;

  enum State {
    AcceptingNRB,
    AcceptingORB,
    // TODO: remove AcceptingURB
    AcceptingURB
  }

  /*
   * Constant
   */
  address constant public NULL_ADDRESS = 0x0000000000000000000000000000000000000000;

  /*
   * Storage
   */
  address public operator;
  State public state;

  // Increase for each URB
  uint public currentFork;

  // First epoch of a fork
  mapping (uint => uint) public firstEpoch;

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
  uint public constant CP_COMPUTATION = 1 days;
  uint public constant CP_WITHHOLDING = 7 days;

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
  event EpochPrepared(uint forkNumber, uint epochNumber, bool isRequest, bool userActivated);

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

  event BlockFinalized(uint _forkNumber, uint _blockNumber);
  event EpochFinalized(uint _forkNumber, uint _epochNumber, uint _firstBlockNumber, uint _lastBlockNumber);

  // emit when exit is finalized. _userActivated is true for ERU
  event RequestFinalized(uint _requestId, bool _userActivated);

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
    require(msg.value == _expected);
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
    uint _NRBEpochLength,

    // genesis block state
    bytes32 _statesRoot,
    bytes32 _transactionsRoot,
    bytes32 _intermediateStatesRoot
  )
    public
  {
    operator = msg.sender;
    NRBEpochLength = _NRBEpochLength;

    Data.PlasmaBlock storage genesis = blocks[currentFork][0];
    genesis.statesRoot = _statesRoot;
    genesis.transactionsRoot = _transactionsRoot;
    genesis.intermediateStatesRoot = _intermediateStatesRoot;

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
  function mapRequestableContract(address _target) external returns (bool success) {
    require(msg.sender.isContract());
    require(requestableContracts[msg.sender] == address(0));

    requestableContracts[msg.sender] = _target;
    return true;
  }

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

  function getEpoch(uint _forkNumber, uint _epochNumber)
    external
    view
    returns (
      uint64 requestStart,
      uint64 requestEnd,
      uint64 startBlockNumber,
      uint64 endBlockNumber,
      uint64 forkedBlockNumber,
      bool isEmpty,
      bool initialized,
      bool isRequest,
      bool userActivated,
      bool finalized
    )
  {
    Data.Epoch epoch = epochs[_forkNumber][_epochNumber];

    requestStart = epoch.requestStart;
    requestEnd = epoch.requestEnd;
    startBlockNumber = epoch.startBlockNumber;
    endBlockNumber = epoch.endBlockNumber;
    forkedBlockNumber = epoch.forkedBlockNumber;
    isEmpty = epoch.isEmpty;
    initialized = epoch.initialized;
    isRequest = epoch.isRequest;
    userActivated = epoch.userActivated;
    /* challenged = epoch.challenged;
    challenging = epoch.challenging; */
    finalized = epoch.finalized;
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
    bytes32 _intermediateStatesRoot
  )
    external
    payable
    onlyOperator
    onlyState(State.AcceptingNRB)
    onlyValidCost(COST_NRB)
    finalizeBlocks
    returns (bool success)
  {
    uint blockNumber = _storeBlock(
      _statesRoot,
      _transactionsRoot,
      _intermediateStatesRoot,
      false,
      false,
      false
    );

    Data.Epoch storage epoch = epochs[currentFork][currentEpoch];

    require(!epoch.isRequest);

    uint numBlocks = epoch.getNumBlocks();
    uint submittedBlocks = highestBlockNumber[currentFork] - epoch.startBlockNumber + 1;

    if (submittedBlocks == numBlocks) {
      _prepareToSubmitORB();
    }

    emit NRBSubmitted(currentFork, blockNumber);
    return true;
  }


  function submitORB(
    bytes32 _statesRoot,
    bytes32 _transactionsRoot,
    bytes32 _intermediateStatesRoot
  )
    external
    payable
    onlyOperator
    onlyState(State.AcceptingORB)
    onlyValidCost(COST_ORB)
    finalizeBlocks
    returns (bool success)
  {
    uint blockNumber = _storeBlock(
      _statesRoot,
      _transactionsRoot,
      _intermediateStatesRoot,
      true,
      false,
      false
    );

    Data.Epoch storage epoch = epochs[currentFork][currentEpoch];

    require(epoch.isRequest);

    uint numBlocks = epoch.getNumBlocks();
    uint submittedBlocks = highestBlockNumber[currentFork] - epoch.startBlockNumber + 1;

    // TODO: verify transactionsRoot

    if (submittedBlocks == numBlocks) {
      _prepareToSubmitNRB();
    }

    emit ORBSubmitted(currentFork, blockNumber);
    return true;
  }

  function submitURB(
    bytes32 _statesRoot,
    bytes32 _transactionsRoot,
    bytes32 _intermediateStatesRoot
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
      _intermediateStatesRoot,
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
  function revertBlock(uint _forkNumber, uint _blockNumber) external {
    // TODO: make a new fork?
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

    Data.TX memory txData = Data.fromBytes(_txByte);
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
    bytes32 _trieKey,
    bytes32 _trieValue
  )
    public
    onlyValidCost(COST_ERO)
    returns (bool success)
  {
    uint requestId;
    uint weiAmount;
    (requestId, weiAmount) = _storeRequest(EROs, ORBs, _to, _trieKey, _trieValue, true, false);

    emit RequestCreated(requestId, msg.sender, _to, weiAmount, _trieKey, _trieValue, true, false);
    return true;
  }

  function startEnter(
    address _to,
    bytes32 _trieKey,
    bytes32 _trieValue
  )
    public
    payable
    returns (bool success)
  {
    uint requestId;
    uint weiAmount;
    (requestId, weiAmount) = _storeRequest(EROs, ORBs, _to, _trieKey, _trieValue, false, false);

    emit RequestCreated(requestId, msg.sender, _to, weiAmount, _trieKey, _trieValue, false, false);
    return true;
  }

  function makeERU(
    address _to,
    bytes32 _trieKey,
    bytes32 _trieValue
  )
    public
    onlyValidCost(COST_ERU)
    returns (bool success)
  {
    uint requestId;
    uint weiAmount;
    (requestId, weiAmount) = _storeRequest(ERUs, URBs, _to, _trieKey, _trieValue, true, true);

    emit RequestCreated(requestId, msg.sender, _to, weiAmount, _trieKey, _trieValue, true, true);
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

      require(ERUs.length < requestId);

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

      if (ERU.isExit && !ERU.applied) {
        ERU.applied = true;

        // NOTE: do not check it reverted or not?
        ERU.to.call(ERU.getData(requestId, true));
      }

      emit RequestFinalized(requestId, true);
      return true;
    }

    // apply ERO
    requestId = lastAppliedERO;

    require(EROs.length < requestId);

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

    if (ERO.isExit && !ERO.applied) {
      ERO.applied = true;

      // NOTE: do not check it reverted or not?
      ERO.to.call(ERO.getData(requestId, true));
    }

    emit RequestFinalized(requestId, false);
    return true;
  }


  /**
   * @notice finalize last Enter or Exit request. this returns the bond in both of
   *         request types. For exit request, this calls applyRequestInRootChain
   *         function of the requestable contract in root chain.
   */
  function finalizeRequest() public returns (bool success) {


    return true;
  }

  /**
   * @notice return true if the chain is forked by URB
   */
  function forked(uint _forkNumber) public returns (bool result) {
    return _forkNumber != currentFork;
  }

  /**
   * @notice return true if the request is applied
   */
  function getRequestApplied(uint _requestId, bool _userActivated) public view returns (bool applied) {
    if (_userActivated) {
      ERUs[_requestId].applied;
    }

    return EROs[_requestId].applied;
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
    bytes32 _intermediateStatesRoot,
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
    b.intermediateStatesRoot = _intermediateStatesRoot;
    b.isRequest = _isRequest;
    b.userActivated = _userActivated;

    highestBlockNumber[currentFork] = blockNumber;
    return;
  }

  function _storeRequest(
    Data.Request[] storage _requests,
    Data.RequestBlock[] storage _rbs,
    address _to,
    bytes32 _trieKey,
    bytes32 _trieValue,
    bool _isExit,
    bool _userActivated
  )
    internal
    returns (uint requestId, uint weiAmount)
  {
    weiAmount = !_isExit ? msg.value :
                _userActivated ? msg.value.sub(COST_ERU) : msg.value.sub(COST_ERO);

    // message call
    require(weiAmount == 0 || requestableContracts[_to] != address(0));

    // deposit ether
    require(!_isExit && weiAmount != 0 || _to != msg.sender);

    requestId = _requests.length++;
    Data.Request storage r = _requests[requestId];

    r.requestor = msg.sender;
    r.value = uint128(weiAmount);
    r.to = _to;
    r.trieKey = _trieKey;
    r.trieValue = _trieValue;
    r.timestamp = uint64(block.timestamp);
    r.isExit = _isExit;

    // apply request in root chain
    if (!_isExit) {
      r.applied = true;
      require(r.applyRequestInRootChain(requestId));
    }

    Data.RequestBlock storage rb = _rbs[_rbs.length - 1];

    // make new RequestBlock
    if (rb.requestEnd - rb.requestStart + 1 == MAX_REQUESTS) {
      rb = _rbs[_rbs.length++];
      rb.requestStart = uint64(requestId);
      rb.init();
    }

    rb.requestEnd = uint64(requestId);
    rb.addRequest(r.toChildChainRequest(requestableContracts[_to]), requestId);
  }

  /**
   * @notice prepare to submit ORB. It prevents further new requests from
   * being included in the request blocks in the just next ORB epoch.
   */
  function _prepareToSubmitORB() internal {
    uint startBlockNumber = highestBlockNumber[currentFork].add(1);
    uint requestStart;

    currentEpoch += 1;
    Data.Epoch storage epoch = epochs[currentFork][currentEpoch];

    epoch.isRequest = true;
    epoch.initialized = true;

    if (currentEpoch == 2) {
      // for the first ORB epoch
      epoch.requestStart = 0;

      if (EROs.length == 0) {
        epoch.isEmpty = true;
      }
    } else {
      // last request id of previous ORB epoch + 1
      requestStart = epochs[currentFork][currentEpoch - 2].requestEnd + 1;

      if (EROs.length + 1 == uint256(requestStart)) {
        epoch.isEmpty = true;
      } else {
        epoch.requestStart = uint64(requestStart - 1);
      }
    }

    if (epoch.isEmpty) {
      epoch.requestEnd = epoch.requestStart;
      epoch.startBlockNumber = uint64(startBlockNumber - 1);
      epoch.endBlockNumber = uint64(startBlockNumber - 1);
    } else {
      epoch.requestEnd = uint64(EROs.length.sub(1));
      epoch.startBlockNumber = uint64(startBlockNumber);
      epoch.endBlockNumber = uint64(startBlockNumber + uint(epoch.requestEnd - epoch.requestStart + 1)
        .divCeil(MAX_REQUESTS) - 1);
    }


    // change state to accept ORBs
    state = State.AcceptingORB;
    emit StateChanged(state);
    emit EpochPrepared(currentFork, currentEpoch, true, false);

    // no ORB to submit
    if (epoch.isEmpty) {
      _prepareToSubmitNRB();
    }
  }

  function _prepareToSubmitNRB() internal {
    uint startBlockNumber = highestBlockNumber[currentFork].add(1);

    currentEpoch += 1;
    Data.Epoch storage epoch = epochs[currentFork][currentEpoch];

    epoch.initialized = true;
    epoch.startBlockNumber = uint64(startBlockNumber);
    epoch.endBlockNumber = uint64(startBlockNumber + NRBEpochLength - 1);

    // change state to accept NRBs
    state = State.AcceptingNRB;
    emit StateChanged(state);
    emit EpochPrepared(currentFork, currentEpoch, false, false);
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

    // short circuit if all blocks are finalized
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
      // return if challenge period doesn't end
      if (pb.timestamp + CP_COMPUTATION <= block.timestamp) {
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
    if (pb.timestamp + CP_WITHHOLDING <= block.timestamp) {
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
  function _checkFinalizable(uint _epochNumber) internal returns (bool) {
    // cannot finalize future epoch
    if (_epochNumber > currentEpoch) {
      return false;
    }

    Data.Epoch storage epoch = epochs[currentFork][_epochNumber];

    // cannot finalize if it is not request epoch
    if (!epoch.isRequest) {
      return false;
    }

    // cannot finalize if the first block was not submitted
    if (_epochNumber == currentEpoch && epoch.startBlockNumber > highestBlockNumber[currentFork]) {
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

    // return true if challenge period end
    if (pb.timestamp + CP_COMPUTATION > block.timestamp) {
      return true;
    }

    return false;
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
