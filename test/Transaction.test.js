const TransactionTest = artifacts.require('TransactionTest');

contract('TransactionTest', async (accounts) => {
  let [
    account1,
    account2
  ] = accounts

  before('#create instance', async () => {
    transactionTest = await TransactionTest.deployed();
  });
  describe('#RLP-encoding', async () => {
    const testHash = '0x0bd8a391244bd7e3e66fda3209d1d4f9c0209da1a6d2de48a8a3fe2198c7c999';

    const nonce = 3;
    const gasPrice = 18000000000;
    const gasLimit = 90000;
    const to = '0x7c23a65d25cc8486557c988f3c9a68c5b595dd10';
    const value = 1000000000000000000;
    const data = '0x';
    const v = '0x1b';
    const r = '0x410c6fb827509f180bebc0277d7cf72dce85d82e4019b21b4fba5f2dcd7f1736';
    const s = '0x513e3030b597c2c2ae4117e88cc86d8610eaf1a374b3049056e6a2c3d2b3ff10';

    it('it should be equal to hash value', async () => {
      const value1 = await transactionTest.getHash(
        nonce,
        gasPrice,
        gasLimit,
        to,
        value,
        data,
        v,
        r,
        s,
        { from: account1 }
      );
      console.log(value1, testHash);
      assert.equal(value1, testHash);
    });
  });
});
