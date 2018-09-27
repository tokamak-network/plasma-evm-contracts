pragma solidity ^0.4.24;

import "./lib/SafeMath.sol";
import "./lib/Math.sol";
import "./lib/Data.sol";


contract RootChain {
  using SafeMath for uint;
  using Math for *;
  using Data for *;

  /*
   * Storage
   */
  address public operator;

  // Increase for each URB
  uint public currentFork;

  // Highest block number of the fork
  mapping (uint => uint) public highestBlock;

  mapping (uint => uint) public lastFinalizedBlock;

  // Last request in the fork
  mapping (uint => uint) public lastRequest;

  mapping (uint => mapping (uint => Data.PlasmaBlock)) public blocks;

  // 1 epoch = N NRBs + k ORBs, epoch length = N
  // Massive requests can be included in k ORBs, and k is determined in preparing
  // step.
  uint public epochLength;

  // the number of NRBs submitted in current epoch. No more than epochLength
  // NRBs can be submitted.
  uint public epochFilled;

  // Increase for each session
  uint public currentEpoch;

  // Enter & Exit requests for ORB & URB
  Data.Request[] public ORBRequests;
  Data.Request[] public URBRequests;

  // Requests info for the ORBs in a single epoch
  mapping (uint => Data.RequestTransactions[]) public ORBs;

  // Requests info for the URBs in a single epoch
  mapping (uint => Data.RequestTransactions[]) public URBs;

  Data.Session public ORBSession;
  Data.Session public URBSession;

  // simple cost parameters
  uint public constant COST_ERO = 0.1 ether;         // cost for invalid exit
  uint public constant COST_ERU = 0.2 ether;         // cost for fork & rebase

  uint public constant COST_URB_PREPARE = 0.1 ether; // cost for URB prepare
  uint public constant COST_URB = 0.9 ether;         // cost for fork & rebase

  uint public constant COST_ORB = 0.1 ether;         // cost for invalid computation
  uint public constant COST_NRB = 0.1 ether;         // cost for invalid computation

  // All sessions are removed after the timeout
  uint public constant SESSION_TIMEOUT = 1 hours;

  // Challenge periods for computation and withholding


  // How many requests can be included in a single request block
  uint public constant MAX_REQUESTS = 1000;

  // Gas limit for request trasaction
  uint public constant REQUEST_GAS = 100000;


  /*
   * Event
   */
  event ORBSesionActivated();
  event URBSesionActivated();
  event SessionTimeout(bool userActivated);

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

  modifier onlyValidSession(Data.Session storage _session, bool _userActivated) {
    if (_session.timestamp + SESSION_TIMEOUT < block.timestamp) {
      _session.reset();

      emit SessionTimeout(_userActivated);
    } else {
      _;
    }
  }

  modifier finalizeBefore() {
    // TODO: update last finalized block
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
   * @notice prepare to submit ORB. It prevents further new requests from
   * being inserted into the request blocks in current epoch.
   */
  function prepareToSubmitORB()
    external
    onlyOperator
    onlyValidSession(ORBSession, false)
    returns (bool)
  {
    require(!URBSession.active);

    if (ORBRequests.length == 0) {
      ORBSession.requestStart = 0;
    } else {
      ORBSession.requestStart = uint128(lastRequest[currentFork].add(1));
    }

    ORBSession.requestEnd = uint128(ORBRequests.length.sub(1));
    ORBSession.active = true;
    ORBSession.setRequestTransactions(ORBs[currentFork], MAX_REQUESTS);

    emit ORBSesionActivated();
    return true;
  }

  /**
   * @notice prepare to submit URB. It prevents further new requests from
   * inserted into the just other request blocks in next epoch.
   */
  function prepareToSubmitURB()
    external
    onlyOperator
    onlyValidSession(URBSession, true)
    returns (bool)
  {

    return true;
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
    uint blockNumber = _storeBlock(
      _statesRoot,
      _transactionsRoot,
      _intermediateStatesRoot,
      false,
      false
    );

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
    uint blockNumber = _storeBlock(
      _statesRoot,
      _transactionsRoot,
      _intermediateStatesRoot,
      true,
      false
    );

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
    // TODO: if ORb is prepared, insert the request in next epoch

    uint requestId = _storeRequest(ORBRequests, _to, _trieKey, _trieValue, true);

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

    uint requestId = _storeRequest(ORBRequests, _to, _trieKey, _trieValue, false);

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
    uint requestId = _storeRequest(URBRequests, _to, _trieKey, _trieValue, true);

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
    Data.Request memory r = ORBRequests[_requestId];
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
}
