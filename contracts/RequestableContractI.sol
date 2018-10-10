pragma solidity ^0.4.24;

interface RequestableContractI {
  function applyRequestInRootChain(
    bool isExit,
    uint256 requestId,
    address requestor,
    bytes32 trieKey,
    bytes32 trieValue
  ) external returns (bool success);

  function applyRequestInChildChain(
    bool isExit,
    uint256 requestId,
    address requestor,
    bytes32 trieKey,
    bytes32 trieValue
  ) external returns (bool success);

}
