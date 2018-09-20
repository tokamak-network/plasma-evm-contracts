pragma solidity ^0.4.24;

import "./SafeMath.sol";


contract RootChain {
  using SafeMath for uint;

  /**
   * Struct
   */
  struct Block {
    bytes32 statesRoot;
    bytes32 transactionsRoot;
    bytes32 intermediateStatesRoot;
    uint64 timestamp;
    bool isRequest;
    bool userActivated;
    bool reverted;
    bool finalized;
    uint requestStart; // first request id
    uint requestEnd;   // last request id
  }

  struct Request {
    address requestor;
    address to;
    address trieKey;
    address trieValue;
    uint64 timestamp;
    bool isExit;
  }

  /**
   * Storage
   */
  address public operator;

  // Increase for each URB
  uint public currentFork;

  // Highest block number for the fork
  mapping (uint => uint) public highestBlock;
  mapping (uint => uint) public lastFinalizedBlock;

  mapping (uint => mapping (uint => Block)) public blocks;

  // Enter & Exit requests for ORB
  Request[] public requests;

  // ERU: Exit requests for URB
  Request[] public ERUs;

  /**
   * Event
   */
  event NRBSubmitted(uint fork, uint blockNumber);
  event ORBSubmitted(uint fork, uint blockNumber);
  event RequestCreated(
    uint requestId,
    address requestor,
    address to,
    address trieKey,
    address trieValue,
    bool isExit
  );

  /**
   * Modifier
   */
  modifier onlyOperator() {
    require(msg.sender == operator);
    _;
  }

  /**
   * Constructor
   */
  function constructor(
    bytes32 _statesRoot,
    bytes32 _transactionsRoot,
    bytes32 _intermediateStatesRoot
  )
    external
  {
    operator = msg.sender;

    Block storage genesis = blocks[currentFork][0];
    genesis.statesRoot = _statesRoot;
    genesis.transactionsRoot = _transactionsRoot;
    genesis.intermediateStatesRoot = _intermediateStatesRoot;
  }


  /**
   * External Functions
   */
  function prepareToSubmitNRB() {

  }

  function prepareToSubmitORB() {

  }

  function submitNRB(
    bytes32 _statesRoot,
    bytes32 _transactionsRoot,
    bytes32 _intermediateStatesRoot
  )
    external
    onlyOperator
  {
    uint blockNumber = _storeBlock(_statesRoot, _transactionsRoot, _intermediateStatesRoot, false);

    // TODO: verify merkle root

    emit NRBSubmitted(currentFork, blockNumber);
  }


  function submitORB(
    bytes32 _statesRoot,
    bytes32 _transactionsRoot,
    bytes32 _intermediateStatesRoot
  )
    external
    onlyOperator
  {
    uint blockNumber = _storeBlock(_statesRoot, _transactionsRoot, _intermediateStatesRoot, true);

    // TODO: verify merkle root
    // TODO: mark request start / end

    emit ORBSubmitted(currentFork, highestBlock[currentFork]);
  }



  function submitURB(
    bytes32 _statesRoot,
    bytes32 _transactionsRoot,
    bytes32 _intermediateStatesRoot
  )
    external
    payable
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
  }

  /**
   * Public Functions
   */
  function getExitFinalized(uint _requestId) public returns (bool) {

  }

  function startExit(
    address _to,
    bytes32 _trieKey,
    bytes32 _trieValue
  )
    public
    returns (bool)
  {
    uint requestId = _storeRequest(_to, _trieKey, _trieValue, true);

    emit RequestCreated(requestId, msg.sender, _to, _trieKey, _trieValue, true);
  }

  function startEnter(
    address _to,
    bytes32 _trieKey,
    bytes32 _trieValue
  )
    public
    returns (bool)
  {
    uint requestId = _storeRequest(_to, _trieKey, _trieValue, false);

    emit RequestCreated(requestId, msg.sender, _to, _trieKey, _trieValue, false);
  }

  /**
   * @notice return true if the chain is forked by URB
   */
  function forked(uint _fork) public returns (bool) {
    return _fork != currentFork;
  }


  /**
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
    address _to,
    bytes32 _trieKey,
    bytes32 _trieValue
    bool _isExit
  )
    internal
    returns (uint requestId)
  {
    requestId = requests.length++;
    Request storage r = requests[requestId];

    r.requestor = msg.sender;
    r.to = _to;
    r.trieKey = _trieKey;
    r.trieValue = _trieValue;
    r.timestamp = block.timestamp;
    r.isExit = _isExit;
  }

}
