pragma solidity ^0.4.24;

import "./SafeMath.sol";
import "./Math.sol";

library Data {
  struct PlasmaBlock {
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
  struct Request {
    uint64 timestamp;
    bool isExit;
    bool finalized;
    address requestor;
    address to;
    bytes32 trieKey;
    bytes32 trieValue;
  }

  // Requests in a single ORB / URB
  struct RequestTransactions {
    uint128 requestStart;
    uint128 requestEnd;
  }

  struct Session {
    uint128 requestStart; // first request id
    uint128 requestEnd;   // last request id
    uint128 numRequestBlocks;
    uint64 timestamp;
    bool active;          // true if it is prepared to submit new block
    bool userActivated;
  }

  function reset(Session storage _s) internal {
    _s.requestStart = 0;
    _s.requestEnd = 0;
    _s.numRequestBlocks = 0;
    _s.timestamp = 0;
    _s.active = false;
    _s.userActivated = false;
  }

  // TODO: check OOG
  function setRequestTransactions(
    Session _session,
    RequestTransactions[] storage _rts,
    uint _limit
  )
    internal
    returns (bool)
  {
    uint numBlocks = SafeMath.add(
      SafeMath.div(
        SafeMath.sub(_session.requestEnd, _session.requestStart),
        _limit
      ),
      1
    );

    RequestTransactions storage rt = _rts[_rts.length++];

    for (uint i = 0; i < numBlocks - 1; i++) {
      // TODO: use SafeMath
      rt.requestStart = uint128(_session.requestStart + _limit * i);
      rt.requestEnd = uint128(_session.requestStart + _limit * (i + 1));

      rt = _rts[_rts.length++];
    }

    rt.requestStart = uint128(_session.requestStart + _limit * (numBlocks - 1));
    rt.requestEnd = uint128(_session.requestEnd);
  }
}
