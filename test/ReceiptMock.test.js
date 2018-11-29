const RLP = require('rlp');
const ReceiptMock = artifacts.require('ReceiptMock');

require('chai')
  .use(require('chai-bytes'))
  .use(require('chai-bignumber')(web3.BigNumber))
  .should();

const BigNumber = web3.BigNumber;

contract('ReceiptMock', async () => {
  let receiptMock, rlpLibrary;
  before(async () => {
    receiptMock = await ReceiptMock.new();
  });

  // eslint-disable-next-line max-len
  const rawReceipt = '0xf9010801825208b9010000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c0';

  const decoded = RLP.decode(rawReceipt);

  it('should decode receipt', async () => {
    const tx = await receiptMock.set(rawReceipt);

    const [
      status,
      cumulativeGasUsed,
    ] = await receiptMock.get();

    buf2num(decoded[0]).should.be.equal(status.toNumber());
    buf2num(decoded[1]).should.be.equal(cumulativeGasUsed.toNumber());
  });

  it('should decode receipt status', async () => {
    const status = await receiptMock.toReceiptStatus(rawReceipt);
    buf2num(decoded[0]).should.be.equal(status.toNumber());
  });
});

function buf2num (buf) {
  return Number('0x' + buf.toString('hex'), 16);
}
