pragma solidity ^0.4.24;

import "./RLP.sol";
import "./RLPEncode.sol";

contract TransactionTest {
  using RLP for bytes;
  using RLP for RLP.RLPItem;
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
  ) public pure returns (bytes32 encodedTxHash) {
    TX memory t;
    bytes memory pack;

    t.nonce = nonce;
    t.gasPrice = gasPrice;
    t.gasLimit = gasLimit;
    t.to = to;
    t.value = value;
    t.data = data;
    t.v = v;
    t.r = r;
    t.s = s;

    pack = abi.encodePacked(
      t.nonce.encodeUint(),
      t.gasPrice.encodeUint(),
      t.gasLimit.encodeUint(),
      t.to.encodeAddress(),
      t.value.encodeUint(),
      t.data.encodeBytes(),
      t.v.encodeUint8(),
      t.r.encodeUint(),
      t.s.encodeUint()
      );

    return keccak256(pack);

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

  /* function getTx(bytes memory txBytes) internal pure returns (TX memory) {
    RLP.RLPItem[] memory rlpTx = txBytes.toRLPItem().toList(13);
    TX memory transaction;

    transaction.blockHash = bytes32(rlpTx[0].toUint());
    transaction.blockNumber = uint8(rlpTx[1].toUint());
    transaction.from = rlpTx[2].toAddress();
    transaction.gas = rlpTx[3].toUint();
    transaction.gasPrice = rlpTx[4].toUint();
    transaction.data = bytes32(rlpTx[5].toUint());
    transaction.nonce = uint8(rlpTx[6].toUint());
    transaction.r = bytes32(rlpTx[7].toUint());
    transaction.s = bytes32(rlpTx[8].toUint());
    transaction.to = rlpTx[9].toAddress();
    transaction.txIndex = uint8(rlpTx[10].toUint());
    transaction.v = uint8(rlpTx[11].toUint());
    transaction.value = uint(rlpTx[12].toUint());

    transaction.txHash = keccak256(txBytes);

    return transaction;
  }

  function hash(Transaction self) internal returns (bytes32) {
    return self.txHash;
  }

  function nullAddress() internal returns (address) {
    return address(0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF);
  } */
}
