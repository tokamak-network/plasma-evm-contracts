pragma solidity ^0.4.24;

import "./RLPEncode.sol";

library Transaction {
  using RLPEncode for *;

  function encodeTX(
    uint64 nonce,
    uint256 gasPrice,
    uint64 gasLimit,
    address to,
    uint256 value,
    bytes data,
    uint256 v,
    uint256 r,
    uint256 s
  ) internal pure returns (bytes32 encodedTxHash) {

    bytes[] memory packArr = new bytes[](9);

    packArr[0] = nonce.encodeUint();
    packArr[1] = gasPrice.encodeUint();
    packArr[2] = gasLimit.encodeUint();
    packArr[3] = to.encodeAddress();
    packArr[4] = value.encodeUint();
    packArr[5] = data.encodeBytes();
    packArr[6] = v.encodeUint();
    packArr[7] = r.encodeUint();
    packArr[8] = s.encodeUint();

    return keccak256(packArr.encodeList());
  }

  // TODO: data = func sig + trie key + value
  /* function toRequestTransaction(
    address _to,
    uint _value,
    uint _nonce,
    bytes _data
  ) internal pure returns (Transaction t) {
    t.from = nullAddress();
    t.to = _to;
    t.value = _value;
    t.nonce = _nonce;
    t.data = _data;
    return t;
  } */
}
