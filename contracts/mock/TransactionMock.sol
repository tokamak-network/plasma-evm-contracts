pragma solidity ^0.5.12;

import "../lib/Data.sol";

contract TransactionMock {
  using Data for Data.TX;

  bytes32 public hash;

  function setHash(
    uint64 nonce,
    uint256 gasPrice,
    uint64 gasLimit,
    address to,
    uint256 value,
    bytes memory data,
    uint256 v,
    uint256 r,
    uint256 s
  ) public {
    // hash = getHash(nonce, gasPrice, gasLimit, to, value, data, v, r, s);
  }

  // function getHash(
  //   uint64 nonce,
  //   uint256 gasPrice,
  //   uint64 gasLimit,
  //   address to,
  //   uint256 value,
  //   bytes data,
  //   uint256 v,
  //   uint256 r,
  //   uint256 s
  // )
  //   public
  //   pure
  //   returns (bytes32)
  // {
  //   return Data.toTX(
  //     nonce,
  //     gasPrice,
  //     gasLimit,
  //     to,
  //     value,
  //     data,
  //     v,
  //     r,
  //     s
  //   ).hash();
  // }
}
