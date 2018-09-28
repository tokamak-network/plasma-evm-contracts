pragma solidity ^0.4.24;

import "./lib/SafeMath.sol";
import "./lib/Math.sol";
import "./lib/Data.sol";


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

  // Increase for each epoch
  uint public currentEpoch;

  // Highest block number of the fork
  mapping (uint => uint) public highestBlock;

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
  uint public epochLength;

  // the number of blocks submitted in an epoch.
  uint public NRBFilled;
  uint public ORBFilled;
  uint public URBFilled;

  // Enter & Exit requests for ORB / URB
  Data.Request[] public EROs;
  Data.Request[] public ERUs;

  // Requests info for the ORBs in a single epoch of a fork
  mapping (uint => mapping (uint => Data.RequestBlock[])) public ORBs;

  // Requests info for the URBs in a fork
  mapping (uint => Data.RequestBlock[]) public URBs;

  // the first epoch of a fork
  mapping (uint => uint) public firstEpoch;

  Data.Session[] public ORBSessions;
  Data.Session[] public URBSessions;

  Data.Session public currentORBSession;
  Data.Session public currentURBSession;

  // simple cost parameters
  uint public constant COST_ERO = 0.1 ether;         // cost for invalid exit
  uint public constant COST_ERU = 0.2 ether;         // cost for fork & rebase

  uint public constant COST_URB_PREPARE = 0.1 ether; // cost for URB prepare
  uint public constant COST_URB = 0.9 ether;         // cost for fork & rebase

  uint public constant COST_ORB = 0.1 ether;         // cost for invalid computation
  uint public constant COST_NRB = 0.1 ether;         // cost for invalid computation

  // All sessions are reset after the timeout
  uint public constant SESSION_TIMEOUT = 1 hours;

  // Challenge periods for computation and withholding
  uint public constant CP_WITHHOLDING = 1 days;
  uint public constant CP_COMPUTATION = 7 days;

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

  modifier onlyValidCost(uint _expected) {
    require(msg.value == _expected);
    _;
  }

  modifier onlyValidSession(Data.Session storage _session, bool _userActivated) {
    if (_session.timestamp + SESSION_TIMEOUT < block.timestamp) {
      _session.reset(_session.userActivated);

      // TODO: revert submitted RBs if the session is out of time

      emit SessionTimeout(_userActivated);
    } else {
      _session.timestamp = block.timestamp;
      _;
    }
  }

  modifier finalizeBefore() {
    // TODO: update last finalized block
    _;
  }

  /**
   * Constructor
   */
  constructor(
    uint _epochLength,
    bytes32 _statesRoot,
    bytes32 _transactionsRoot,
    bytes32 _intermediateStatesRoot
  )
    public
  {
    operator = msg.sender;
    epochLength = _epochLength;

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
    require(NRBFilled < epochLength);

    uint blockNumber = _storeBlock(
      _statesRoot,
      _transactionsRoot,
      _intermediateStatesRoot,
      false,
      false
    );
    NRBFilled = NRBFilled.add(1);

    if (NRBFilled == epochLength) {
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
    require(currentORBSession.blockSubmitted < currentORBSession.numRequestBlocks);

    uint blockNumber = _storeBlock(
      _statesRoot,
      _transactionsRoot,
      _intermediateStatesRoot,
      true,
      false
    );

    currentORBSession.blockSubmitted = currentORBSession.blockSubmitted.add(1);

    // TODO: verify merkle root
    // TODO: mark request start / end

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
    // TODO: mark request start / end

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
    // TODO: if ORB is prepared, insert the request in next epoch

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
    // TODO: if ORb is prepared, insert the request in next epoch

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

  function finalizeExit() public returns (bool) {
    // TODO: find the request block including _requestId with binary search
    return true;
  }

  /**
   * @notice return true if the chain is forked by URB
   */
  function forked(uint _fork) public returns (bool) {
    return _fork != currentFork;
  }

  function getExitFinalized(uint _requestId) public view returns (bool) {
    Data.Request memory r = EROs[_requestId];
    require(r.isExit);

    return r.finalized;
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
    blockNumber = highestBlock[currentFork].add(1);

    if (_userActivated) {
      currentFork = currentFork.add(1);
    }

    Data.PlasmaBlock storage b = blocks[currentFork][blockNumber];

    b.statesRoot = _statesRoot;
    b.transactionsRoot = _transactionsRoot;
    b.intermediateStatesRoot = _intermediateStatesRoot;
    b.isRequest = _isRequest;

    highestBlock[currentFork] = blockNumber;
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
   * being inserted into the request blocks in current epoch.
   */
  function _prepareToSubmitORB() internal {
    uint startBlockNumber = highestBlock[currentEpoch];

    currentEpoch += 1;
    Data.Epoch storage epoch = epochs[currentFork][currentEpoch];

    if (currentEpoch == 1) {
      // first ORB epoch
      epoch.requestStart = 0;
    } else {
      // last request id of previous ORB epoch + 1
      epoch.requestStart = epochs[currentFork][currentEpoch - 2].requestEnd + 1;
    }

    epoch.requestEnd = uint64(EROs.length.sub(1));
    epoch.startBlockNumber = startBlockNumber;
    epoch.endBlockNumber = uint64(startBlockNumber +
      uint(epoch.requestEnd - epoch.requestStart + 1).divCeil(MAX_REQUESTS));

    state = State.AcceptingORB;
    emit StateChanged(state);
  }

  function _prepareToSubmitURB() internal {
    /* if (currentFork == 0) {
      currentURBSession.requestStart = 0;
    } else {
      uint previousFork = currentFork.sub(1);
      currentURBSession.requestStart = uint128(URBs[previousFork].getNextRequestId());
    }

    currentURBSession.requestEnd = uint128(ERUs.length.sub(1));
    currentURBSession.prepare(URBs[currentFork], MAX_REQUESTS);

    emit StateChanged(true); */
  }
}
