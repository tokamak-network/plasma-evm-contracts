pragma solidity ^0.5.12;

import "./lib/Data.sol";


contract Layer2Event {
  event OperatorChanged(address _newOperator);

  event SessionTimeout(bool userActivated);

  event Forked(uint newFork, uint epochNumber, uint forkedBlockNumber);

  /**
   * epochNumber          the number of prepared epoch
   * startBlockNumber     first block number of the epoch.
   * endBlockNumber       last block number of the epoch. It is 0 for ORE' and NRE'.
   * requestStart         first request id of the epoch.
   * requestEnd           last request id of the epoch.
   * epochIsEmpty         true if epoch doesn't have block.
   * isRequest            true for ORE and URE.
   * userActivated        true for URE.
   */
  event EpochPrepared(
    uint forkNumber,
    uint epochNumber,
    uint startBlockNumber,
    uint endBlockNumber,
    uint requestStart,
    uint requestEnd,
    bool epochIsEmpty,
    bool isRequest,
    bool userActivated,
    bool rebase
  );

  event EpochFilling(
    uint forkNumber,
    uint epochNumber
  );

  event EpochFilled(
    uint forkNumber,
    uint epochNumber
  );

  event EpochRebased(
    uint forkNumber,
    uint epochNumber,
    uint startBlockNumber,
    uint endBlockNumber,
    uint requestStart,
    uint requestEnd,
    bool epochIsEmpty,
    bool isRequest,
    bool userActivated
  );

  event BlockSubmitted(
    uint fork,
    uint epochNumber,
    uint blockNumber,
    bool isRequest,
    bool userActivated
  );

  event RequestCreated(
    uint requestId,
    address requestor,
    address to,
    uint weiAmount,
    bytes32 trieKey,
    bytes trieValue,
    bool isExit,
    bool userActivated
  );
  event ERUCreated(
    uint requestId,
    address requestor,
    address to,
    bytes trieKey,
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

  event RequestableContractMapped(address contractInRootchain, address contractInChildchain);
}
