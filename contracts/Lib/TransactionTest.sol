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

  function toBytes(uint256 x) internal pure returns (bytes b) {
    b = new bytes(32);
    assembly { mstore(add(b, 32), x) }
  }

  function getHash(
    uint256 nonce,
    uint256 gasPrice,
    uint256 gasLimit,
    uint256 to,
    uint256 value,
    uint256 data,
    uint256 v,
    uint256 r,
    uint256 s
  ) public pure returns (bytes32) {
    TX memory t;
    bytes32 encodedhash;

    t.nonce = nonce;
    t.gasPrice = gasPrice;
    t.gasLimit = gasLimit;
    t.to = address(to);
    t.value = value;
    t.data = toBytes(data);
    t.v = uint8(v);
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

  function stringToBytes32(string memory source) returns (bytes32 result) {
    bytes memory tempEmptyStringTest = bytes(source);
    if (tempEmptyStringTest.length == 0) {
        return 0x0;
    }

    assembly {
        result := mload(add(source, 32))
    }
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

    bytes[] memory encodedNonce = new bytes[](2);

    encodedNonce = [stringToBytes32("nonce").encodeBytes(), nonce.encodeUint()];

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
