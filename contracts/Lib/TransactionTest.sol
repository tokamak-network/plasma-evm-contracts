pragma solidity ^0.4.24;

import "./RLPEncode.sol";

contract TransactionTest {
  using RLPEncode for *;

  struct TX {
    uint256 nonce;
    uint256 gasPrice;
    uint256 gasLimit;
    address to;
    uint256 value;
    bytes data;
    uint8 v;
    uint256 r;
    uint256 s;
  }

  function getHashGasTest(
    uint256 nonce,
    uint256 gasPrice,
    uint256 gasLimit,
    address to,
    uint256 value,
    bytes data,
    uint8 v,
    uint256 r,
    uint256 s
  ) public {
    getHash(nonce, gasPrice, gasLimit, to, value, data, v, r, s);
  }

  function getHash(
    uint256 nonce,
    uint256 gasPrice,
    uint256 gasLimit,
    address to,
    uint256 value,
    bytes data,
    uint8 v,
    uint256 r,
    uint256 s
  ) public pure returns (bytes32) {
    TX memory t;
    bytes32 encodedhash;

    t.nonce = nonce;
    t.gasPrice = gasPrice;
    t.gasLimit = gasLimit;
    t.to = to;
    t.value = value;
    t.data = data;
    t.v = v;
    t.r = r;
    t.s = s;

    encodedhash = encodeTX(
      t.nonce,
      t.gasPrice,
      t.gasLimit,
      t.to,
      t.value,
      t.data,
      t.v,
      t.r,
      t.s
    );

    return encodedhash;
  }

  function encodeTX(
    uint256 nonce,
    uint256 gasPrice,
    uint256 gasLimit,
    address to,
    uint256 value,
    bytes data,
    uint8 v,
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
