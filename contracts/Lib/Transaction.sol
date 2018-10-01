pragma solidity ^0.4.24;

import "./RLPEncoder.sol";

library Transaction {
  using RLPEncoder for bytes;

  bytes[] tx_list;

  struct Tx {
    uint8 nonce;
    uint gas;
    uint gasPrice;
    address to;
    uint value;
    bytes data;
    uint8 v;
    bytes r;
    bytes s;
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



  function txHash(Transaction self) internal returns (bytes) {
    tx_list.push(RLPEncoder.encodeUint(self.nonce));
    tx_list.push(RLPEncoder.encodeUint(self.gasPrice));
    tx_list.push(RLPEncoder.encodeUint(self.gas));
    tx_list.push(RLPEncoder.encodeAddress(self.to));
    tx_list.push(RLPEncoder.encodeUint(self.value));
    tx_list.push(self.data);
    tx_list.push(RLPEncoder.encodeUint(self.v));
    tx_list.push(self.r);
    tx_list.push(self.s);

    return RLPEncoder.encodeList(tx_list);
  }

  function nullAddress() internal returns (address) {
    return address(0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF);
  }
}
