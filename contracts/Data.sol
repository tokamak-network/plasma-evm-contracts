pragma solidity ^0.4.24;

import "./RLP.sol";

library Data {
  struct Transaction {
    address from;
    address to;
    uint value;
    uint nonce;
    bytes data;
  }

  // TODO: data = func sig + trie key + value
  function toRequestTransaction(
    address _to,
    uint _value,
    uint _nonce,
    bytes _data
  ) internal pure returns (Transaction memory t) {
    t.from = nullAddress();
    t.to = _to;
    t.value = _value;
    t.nonce = _nonce;
    t.data = _data;
  }

  function hash(Transaction self) internal returns (bytes32) {
  }

  function nullAddress() internal returns (address) {
    return address(0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF);
  }
}
