pragma solidity ^0.4.24;

import "./SafeMath.sol";
import "./Math.sol";

library Data {
  using SafeMath for *;

  struct PlasmaBlock {
    bytes32 statesRoot;
    bytes32 transactionsRoot;
    bytes32 intermediateStatesRoot;
    uint64 forkNumber;
    uint64 epochNumber;
    uint64 timestamp;
    bool isRequest;           // true in case of URB & ORB
    bool userActivated;       // true in case of URB
    bool challenged;          // true if it is challenged
    bool challenging;         // true if it is being challenged
  }

  struct Request {
    uint64 timestamp;
    bool isExit;
    bool finalized;
    bool challenged;
    address requestor;
    address to;
    bytes32 trieKey;
    bytes32 trieValue;
    bytes32 txHash;           // request trasaction hash
  }

  struct RequestBlock {
    uint64 requestStart;      // first request id
    uint64 requestEnd;        // last request id
  }

  struct Epoch {
    uint64 requestStart;      // first request id
    uint64 requestEnd;        // last request id
    uint64 startBlockNumber;  // first block number of the epoch
    uint64 endBlockNumber;    // last block number of the epoch
    uint64 forkedBlockNumber; // forked block number due to URB

    uint64 limit;             // the maximum number of request transactions in
                              // a request block

    uint64 timestamp;         // timestamp when the epoch is initialized.
                              // required for URB / ORB

    bool isRequest;           // true in case of URB / ORB
    bool userActivated;       // true in case of URB
    bool challenged;          // true if a block in the epoch is challenged
    bool challenging;         // true if a block in the epoch is being challenged
    bool finalized;           // true if it is successfully finalized
  }

  function getNumBlocks(Epoch _e) internal returns (uint) {
    if (_e.startBlockNumber == _e.endBlockNumber) return 0;
    return _e.endBlockNumber - _e.startBlockNumber + 1;
  }

  /**
   * @notice This returns the request block number if the request is included
   *         in an epoch. Otherwise, returns 0.
   */
  function getBlockNumber(Epoch _e, uint _requestId) internal returns (uint) {
    if (!_e.isReqeust
      || _e.limit == 0
      || _e.requestStart < requestId
      || _e.requestEnd > requestId) {
        return 0;
    }

    return uint(_e.startBlockNumber)
      .add(uint(_requestId - _e.requestStart + 1).divCeil(_e.limit));
  }


  function getRequestRange(Epoch _e, uint _blockNumber, uint _limit) internal returns (uint requestStart, uint requestEnd) {
    require(_e.isRequest);
    require(_blockNumber >= _e.startBlockNumber && _blockNumber <= _e.endBlockNumber);

    if (_blockNumber == _e.endBlockNumber) {
      requestStart = _e.requestStart + (getNumBlocks(_e) - 1) * _limit;
      requestEnd = _e.requestEnd;
      return;
    }

    requestStart = _e.requestStart + (_blockNumber - _e.startBlockNumber) * _limit;
    requestEnd = requestStart + _limit;
    return;
  }
}
