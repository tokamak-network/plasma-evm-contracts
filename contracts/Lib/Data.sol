pragma solidity ^0.4.24;

import "./RLP.sol";

library Data {
  using RLP for bytes;
  using RLP for RLP.RLPItem;

  struct TX {
    bytes32 txHash;
    uint8 nonce;
    bytes32 blockHash;
    uint8 blockNumber;
    uint gasPrice;
    uint gas;
    address from;
    address to;
    uint value;
    bytes32 data;
    uint8 txIndex;
    uint8 v;
    bytes32 r;
    bytes32 s;
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

  function getTx(bytes memory txBytes) internal pure returns (TX memory) {
    RLP.RLPItem[] memory rlpTx = txBytes.toRLPItem().toList(13);
    TX memory transaction;

    //        transaction.blockHash = keccak256(abi.encodePacked(rlpTx[0]));
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
  }
}
