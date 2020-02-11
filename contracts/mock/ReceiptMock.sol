pragma solidity ^0.5.12;
pragma experimental ABIEncoderV2;

import "../lib/Data.sol";

contract ReceiptMock {
  Data.Receipt public receipt;

  function get() public view returns (uint64 status, uint64 cumulativeGasUsed, bytes memory bloom) {
    status = receipt.status;
    cumulativeGasUsed = receipt.cumulativeGasUsed;
    bloom = receipt.bloom;
    // logs = receipt.logs;
  }

  function set(bytes memory receiptData) public {
    Data.Receipt memory r = Data.toReceipt(receiptData);
    receipt.status = r.status;
    receipt.cumulativeGasUsed = r.cumulativeGasUsed;
    receipt.bloom = r.bloom;
  }

  function toReceiptStatus(bytes memory receiptData) public view returns (uint) {
      return Data.toReceiptStatus(receiptData);
  }
}
