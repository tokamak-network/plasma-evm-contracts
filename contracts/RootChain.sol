pragma solidity ^0.4.24;

import "./lib/SafeMath.sol";
import "./lib/Math.sol";
import "./lib/Data.sol";


// TODO: use SafeMath
contract RootChain {
  using SafeMath for uint;
  using Math for *;
  using Data for *;

  enum State {
    AcceptingNRB,
    AcceptingORB,
    AcceptingURB
  }

  /*
   * Storage
   */
  address public operator;
  State public state;

  // Increase for each URB
  uint public currentFork;

  // the first epoch of a fork
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

  // Requests info for the ORBs in a single epoch of a fork
  mapping (uint => mapping (uint => Data.RequestBlock[])) public ORBs;

  // Requests info for the URBs in a fork
  mapping (uint => Data.RequestBlock[]) public URBs;

  // last finalized reqeust block
  uint public lastFinalizedORB;
  uint public lastFinalizedURB;

  // last finalize request
  uint public lastFinalizedERO;
  uint public lastFinalizedERU;


  // simple cost parameters
  uint public constant COST_ERO = 0.1 ether;         // cost for invalid exit
  uint public constant COST_ERU = 0.2 ether;         // cost for fork & rebase
  uint public constant COST_URB_PREPARE = 0.1 ether; // cost for URB prepare
  uint public constant COST_URB = 0.9 ether;         // cost for fork & rebase
  uint public constant COST_ORB = 0.1 ether;         // cost for invalid computation
  uint public constant COST_NRB = 0.1 ether;         // cost for invalid computation

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

  event NRBSubmitted(uint fork, uint blockNumber);
  event ORBSubmitted(uint fork, uint blockNumber);
  event URBSubmitted(uint fork, uint blockNumber);

  event RequestCreated(
    uint requestId,
    address requestor,
    address to,
    bytes32 trieKey,
    bytes32 trieValue,
    bool isExit
  );
  event ERUCreated(
    uint requestId,
    address requestor,
    address to,
    bytes32 trieKey,
    bytes32 trieValue
  );

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

  /**
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
  }


  /*
   * External Functions
   */

  /**
   * @notice Declare to submit URB.
   */
  function prepareToSubmitURB()
    external
    onlyOperator
    onlyValidSession(currentURBSession, true)
    returns (bool)
  {
    state = State.AcceptingURB;
    return true;
  }

  // TODO: Delegate the validity check to TrueBit Verification Game contracts
  function submitNRB(
    bytes32 _statesRoot,
    bytes32 _transactionsRoot,
    bytes32 _intermediateStatesRoot
  )
    external
    onlyOperator
    onlyState(State.AcceptingNRB)
    onlyValidCost(COST_NRB)
    returns (bool)
  {
    // double check
    require(NRBFilled < NRBEpochLength);

    uint blockNumber = _storeBlock(
      _statesRoot,
      _transactionsRoot,
      _intermediateStatesRoot,
      false,
      false
    );
    NRBFilled = NRBFilled.add(1);

    if (NRBFilled == NRBEpochLength) {
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
    onlyOperator
    onlyState(State.AcceptingORB)
    onlyValidCost(COST_ORB)
    returns (bool)
  {
    Epoch storage epoch = epochs[currentFork][currentEpoch];
    uint numBlocks = epoch.getNumBlocks();

    // double check
    require(ORBFilled < numBlocks);

    uint blockNumber = _storeBlock(
      _statesRoot,
      _transactionsRoot,
      _intermediateStatesRoot,
      true,
      false
    );

    // TODO: verify merkle root

    ORBFilled = ORBFilled.add(1);

    if (ORBFilled == numBlocks) {
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
    returns (bool)
  {
    uint blockNumber = _storeBlock(
      _statesRoot,
      _transactionsRoot,
      _intermediateStatesRoot,
      true,
      true
    );

    // TODO: verify merkle root

    emit ORBSubmitted(currentFork, blockNumber);
    return true;
  }

  /**
   * Public Functions
   */
  function startExit(
    address _to,
    bytes32 _trieKey,
    bytes32 _trieValue
  )
    public
    onlyValidCost(COST_ERO)
    returns (bool)
  {
    uint requestId = _storeRequest(EROs, _to, _trieKey, _trieValue, true);

    emit RequestCreated(requestId, msg.sender, _to, _trieKey, _trieValue, true);
    return true;
  }

  function startEnter(
    address _to,
    bytes32 _trieKey,
    bytes32 _trieValue
  )
    public
    returns (bool)
  {
    uint requestId = _storeRequest(EROs, _to, _trieKey, _trieValue, false);

    emit RequestCreated(requestId, msg.sender, _to, _trieKey, _trieValue, false);
    return true;
  }

  function makeERU(
    address _to,
    bytes32 _trieKey,
    bytes32 _trieValue
  )
    public
    onlyValidCost(COST_ERU)
    returns (bool)
  {
    uint requestId = _storeRequest(ERUs, _to, _trieKey, _trieValue, true);

    emit ERUCreated(requestId, msg.sender, _to, _trieKey, _trieValue);
    return true;
  }

  /**
   * @notice finalize last Enter or Exit request. this returns the bond in both of
   *         request types. For exit request, this calls applyRequestInRootChain
   *         function of the requestable contract in root chain.
   */
  function finalizeRequest() public returns (bool) {
    if (!_finalizeERU()) {
      return _finalizeERO();
    }

    return true;
  }

  /**
   * @notice return true if the chain is forked by URB
   */
  function forked(uint _fork) public returns (bool) {
    return _fork != currentFork;
  }

  /**
   * @notice return true if the request is finalized
   */
  function getRequestFinalized(uint _requestId, uint _userActivated) public view returns (bool) {
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
    bool _userActivated
  )
    internal
    returns (uint blockNumber)
  {
    blockNumber = highestBlockNumber[currentFork].add(1);

    if (_userActivated) {
      currentFork = currentFork.add(1);
    }

    Data.PlasmaBlock storage b = blocks[currentFork][blockNumber];

    b.statesRoot = _statesRoot;
    b.transactionsRoot = _transactionsRoot;
    b.intermediateStatesRoot = _intermediateStatesRoot;
    b.isRequest = _isRequest;

    highestBlockNumber[currentFork] = blockNumber;
  }

  function _storeRequest(
    Data.Request[] storage _requests,
    address _to,
    bytes32 _trieKey,
    bytes32 _trieValue,
    bool _isExit
  )
    internal
    returns (uint requestId)
  {
    requestId = _requests.length++;
    Data.Request storage r = _requests[requestId];

    r.requestor = msg.sender;
    r.to = _to;
    r.trieKey = _trieKey;
    r.trieValue = _trieValue;
    r.timestamp = uint64(block.timestamp);
    r.isExit = _isExit;
  }

  /**
   * @notice prepare to submit ORB. It prevents further new requests from
   * being included in the request blocks in the just next ORB epoch.
   */
  function _prepareToSubmitORB() internal {
    uint startBlockNumber = highestBlockNumber[currentEpoch].add(1);

    currentEpoch += 1;
    Data.Epoch storage epoch = epochs[currentFork][currentEpoch];

    if (currentEpoch == 1) {
      // first ORB epoch
      epoch.requestStart = 0;
    } else {
      // last request id of previous ORB epoch + 1
      epoch.requestStart = epochs[currentFork][currentEpoch - 2].requestEnd + 1;
    }

    epoch.isRequest = true;
    epoch.requestEnd = uint64(EROs.length.sub(1));
    epoch.startBlockNumber = startBlockNumber;
    epoch.endBlockNumber = uint64(startBlockNumber + uint(epoch.requestEnd - epoch.requestStart + 1).divCeil(MAX_REQUESTS) - 1);

    // reset NRB submit info
    NRBFilled = 0;

    // change state to accept ORBs
    state = State.AcceptingORB;
    emit StateChanged(state);
  }

  function _prepareToSubmitNRB() internal {
    uint startBlockNumber = highestBlockNumber[currentEpoch].add(1);

    currentEpoch += 1;
    Data.Epoch storage epoch = epochs[currentFork][currentEpoch];

    epoch.startBlockNumber = startBlockNumber;
    epoch.endBlockNumber = uint64(startBlockNumber + NRBEpochLength - 1);

    // reset ORB submit info
    ORBFilled = 0;

    // change state to accept NRBs
    state = State.AcceptingNRB;
    emit StateChanged(state);
  }

  function _prepareToSubmitURB() internal {

  }

  function _finalizeBlock() internal onlyNotState(State.AcceptingURB) {
    uint blockNumber = lastFinalizedBlock[currentFork] + 1;

    // return if no unfinalized block exists
    if (blockNumber > highestBlockNumber[currentFork]) {
      return;
    }

    Data.PlasmaBlock storage pb = blocks[currrentFork][blockNumber];

    // finalize request block
    if (pb.isRequest) {
      // return if challenge period doesn't end
      if (pb.timestamp + CP_COMPUTATION <= block.timestamp) {
        return;
      }

      // mark the block as finalized
      pb.finalized = true;
      return;
    }

    // finalize non request block
    uint nextEpochNumber = pb.epochNumber + 1;

    // return if challenge period doesn't end
    if (pb.timestamp + CP_WITHHOLDING <= block.timestamp) {
      return;
    }

    // if the first block of the next request epoch is finalized, finalize this block too.
    if (_finalizeFirstEpoch(nextEpochNumber)) {
      pb.finalized = true;
      lastFinalizedBlock[currentFork] = blockNumber;
      return;
    }

    // TODO: check NRB was not challenged
  }

  /**
   * @notice finalize the first block of a request epoch (ORB epoch / URB epoch).
   *         return true if the block is finalized.
   */
  function _finalizeFirstBlock(uint _epochNumber) internal returns (bool) {
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

    // finalize first block if challenge period end
    if (pb.timestamp + CP_COMPUTATION > block.timestamp) {
      pb.finalized = true;
      return true;
    }

    return false;
  }

  /**
   * @notice finalize ERUs in the first epoch of current fork.
   *         return true if an ERU is finalized.
   */
  function _finalizeERU() internal returns (bool) {
    // short circuit if not forked yet
    if (currentFork != 0) {
      return false;
    }

    Data.Epoch storage previousRequestEpoch = epoch[currentFork - 1][firstEpoch[currentFork] - 1];
    Data.Epoch storage epoch = epoch[currentFork][firstEpoch[currentFork]];

    if (!previousRequestEpoch.isRequest) {
      previousRequestEpoch = epoch[currentFork - 1][firstEpoch[currentFork] - 2];
    }

    // NOTE: ORB epoch number = firstEpoch - 1?

    // short circuit if EROs are not finalized yet
    if (lastFinalizedERO < ORBEpoch.requestStart) {
      return false;
    }

    // if there is an ERU that is not finalized yet
    if (lastFinalizedERU <= ERUs.length) {
      Data.Request storage ERU = ERUs[lastFinalizedERU + 1];
    }

    /* Data.PlasmaBlock storage pb = blocks[last]; */
    return true;
  }

  /**
   * @notice finalize ERUs in the first epoch of current fork.
   *         return true if an ERU is finalized.
   */
  function _finalizeERO() internal returns (bool) {

  }
}
