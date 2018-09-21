pragma solidity ^0.4.24;

import "./SafeMath.sol";
import "./Math.sol";


contract RootChain {
  using SafeMath for uint;
  using Math for *;

  /*
   * Struct
   */
  struct Block {
    bytes32 statesRoot;
    bytes32 transactionsRoot;
    bytes32 intermediateStatesRoot;
    uint128 requestStart; // first request id of ORB & NRB
    uint128 requestEnd;   // last request id of ORB & NRB
    uint64 timestamp;
    bool isRequest;       // true in case of URB & ORB
    bool userActivated;   // true in case of URB
    bool reverted;        // true if it is challenged
    bool finalized;       // true if it is not challenged in challenge period
  }

  struct SubmitSession {
    uint128 requestStart; // first request id
    uint128 requestEnd;   // last request id
    uint64 timestamp;
    bool active;          // true if it is prepared to submit new block
    bool userActivated;
  }

  struct Request {
    address requestor;
    address to;
    bytes32 trieKey;
    bytes32 trieValue;
    uint64 timestamp;
    bool isExit;
    bool finalized;
  }

  /*
   * Storage
   */
  address public operator;

  // Increase for each URB
  uint public currentFork;

  // Highest block number of the fork
  mapping (uint => uint) public highestBlock;

  mapping (uint => uint) public lastFinalizedBlock;

  // last request in the fork
  mapping (uint => uint) public lastRequest;

  mapping (uint => mapping (uint => Block)) public blocks;

  // Enter & Exit requests for ORB
  Request[] public requests;

  // ERU: Exit requests for URB
  Request[] public ERUs;

  SubmitSession public URBSession;
  SubmitSession public ORBSession;

  // simple cost parameters
  uint public constant COST_ERO = 0.1 ether; // cost for invalid exit
  uint public constant COST_ERU = 0.2 ether; // cost for fork & rebase
  uint public constant COST_URB = 0.9 ether; // cost for fork & rebase
  uint public constant COST_URB_PREPARE = 0.1 ether;
  uint public constant COST_ORB = 0.1 ether; // cost for invalid computation
  uint public constant COST_NRB = 0.1 ether; // cost for invalid computation

  // All sessions are removed after the timeout
  uint public constant SESSION_TIMEOUT = 1 hours;

  // Challenge periods for computation and withholding
  uint public constant CP_COMPUTATION = 1 days;
  uint public constant CP_WITHHOLDING = 7 days;

  uint public constant MAX_REQUESTS = 1000;


  /*
   * Event
   */
  event ORBSesionActivated();
  event ORBSesionTimeout();
  event URBSesionActivated();
  event URBSesionTimeout();

  event NRBSubmitted(uint fork, uint blockNumber);
  event ORBSubmitted(uint fork, uint blockNumber);

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

  modifier onlyValidCost(uint _expected) {
    require(msg.value == _expected);
    _;
  }

  modifier setupSession() {
    // TODO: prepare session
    _;
  }

  /**
   * Constructor
   */
  constructor(
    bytes32 _statesRoot,
    bytes32 _transactionsRoot,
    bytes32 _intermediateStatesRoot
  )
    public
  {
    operator = msg.sender;

    Block storage genesis = blocks[currentFork][0];
    genesis.statesRoot = _statesRoot;
    genesis.transactionsRoot = _transactionsRoot;
    genesis.intermediateStatesRoot = _intermediateStatesRoot;
  }


  /*
   * External Functions
   */

  /**
   * @notice This
   */
  function prepareToSubmitORB() external onlyOperator returns (bool) {
    if (ORBSession.timestamp + SESSION_TIMEOUT < block.timestamp) {
      ORBSession = _newSession();

      emit ORBSesionTimeout();
      return false;
    }

    require(!URBSession.active);

    if (requests.length == 0) {
      ORBSession.requestStart = 1;
    } else {
      ORBSession.requestStart = requests[requests.length.sub(1)].requestEnd.add(1);
    }

    ORBSession.requestEnd = _getLastRequest(requests, ORBSession.requestStart);
    ORBSession.active = true;

    event ORBSesionActivated();
    return true;
  }

  /**
   * @notice This
   */
  function prepareToSubmitURB() external onlyOperator returns (bool) {

  }



  function submitNRB(
    bytes32 _statesRoot,
    bytes32 _transactionsRoot,
    bytes32 _intermediateStatesRoot
  )
    external
    onlyOperator
    onlyValidCost(COST_NRB)
    returns (bool)
  {
    uint blockNumber = _storeBlock(_statesRoot, _transactionsRoot, _intermediateStatesRoot, false);

    // TODO: verify merkle root

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
    onlyValidCost(COST_ORB)
    returns (bool)
  {
    uint blockNumber = _storeBlock(_statesRoot, _transactionsRoot, _intermediateStatesRoot, true);

    // TODO: verify merkle root
    // TODO: mark request start / end

    emit ORBSubmitted(currentFork, highestBlock[currentFork]);
    return true;
  }



  function submitURB(
    bytes32 _statesRoot,
    bytes32 _transactionsRoot,
    bytes32 _intermediateStatesRoot
  )
    external
    payable
    onlyValidCost(COST_URB)
    returns (bool)
  {
    // TODO: collect submission cost
    // TODO: check ERUs is ready

    uint blockNumber = _storeBlock(
      _statesRoot,
      _transactionsRoot,
      _intermediateStatesRoot,
      true
    );
    // TODO: verify merkle root
    // TODO: mark request start / end

    emit ORBSubmitted(currentFork, highestBlock[currentFork]);
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
    uint requestId = _storeRequest(requests, _to, _trieKey, _trieValue, true);

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
    uint requestId = _storeRequest(requests, _to, _trieKey, _trieValue, false);

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

  }

  /**
   * @notice return true if the chain is forked by URB
   */
  function forked(uint _fork) public returns (bool) {
    return _fork != currentFork;
  }

  function getExitFinalized(uint _requestId) public view returns (bool) {
    Request memory r = requests[_requestId];
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
    bool _isRequest
  )
    internal
    returns (uint blockNumber)
  {
    blockNumber = highestBlock[currentFork].add(1);

    Block storage b = blocks[currentFork][blockNumber];

    b.statesRoot = _statesRoot;
    b.transactionsRoot = _transactionsRoot;
    b.intermediateStatesRoot = _intermediateStatesRoot;
    b.isRequest = _isRequest;

    highestBlock[currentFork] = blockNumber;
  }

  function _storeRequest(
    Request[] storage _requests,
    address _to,
    bytes32 _trieKey,
    bytes32 _trieValue,
    bool _isExit
  )
    internal
    returns (uint requestId)
  {
    requestId = _requests.length++;
    Request storage r = _requests[requestId];

    r.requestor = msg.sender;
    r.to = _to;
    r.trieKey = _trieKey;
    r.trieValue = _trieValue;
    r.timestamp = uint64(block.timestamp);
    r.isExit = _isExit;
  }

  function _getLastRequest(Requests[] storage _requests, uint _requestStart) internal returns (uint) {
    return _requests.length.sub(1).min(_requestStart.add(MAX_REQUESTS));
  }

  function _newSession() internal returns (SubmitSession memory s) {
    return s;
  }
}
