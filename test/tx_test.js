const TransactionTest = artifacts.require('TransactionTest');
const RLPEncodeTest = artifacts.require('RLPEncodeTest');
const rlp = require('rlp');
let toHex = (buff) => { return "0x" + buff.toString("hex") };

//hash: '0x5f2998fcf49b566ee99dbefb1d48be87c99f6df67d26c87372b5c02624daa5f2',

contract('TransactionTest', () => {
  let txTest;
  let rlpTest;

  const nonce = 2;
  const gasPrice= 18000000000;
  const gas = 90000;
  const to = '0x7c23a65d25cc8486557c988f3c9a68c5b595dd10';
  const value = 1000000000000000000;
  const input = '0x';
  const v = '0x17736';
  const r = '0xf67bf637c721e368041d924b8c8b8a9f5a897bf5f465fd8c6390458feb7d78ac';
  const s = '0xec4b5eca2d926ed401d27ac450a1e72f81cbc23482314be54b14f48220d44c9';

  const rawTxByte = '0xf87002850430e2340083015f90947c23a65d25cc8486557c988f3c9a68c5b595dd10880de0b6b3a76400008083017736a0f67bf637c721e368041d924b8c8b8a9f5a897bf5f465fd8c6390458feb7d78aca00ec4b5eca2d926ed401d27ac450a1e72f81cbc23482314be54b14f48220d44c9';

  const tx = [2,18000000000,90000,'0x7c23a65d25cc8486557c988f3c9a68c5b595dd10',1000000000000000000,'0x','0x17736','0xf67bf637c721e368041d924b8c8b8a9f5a897bf5f465fd8c6390458feb7d78ac','0xec4b5eca2d926ed401d27ac450a1e72f81cbc23482314be54b14f48220d44c9'];

  const encode_tx = toHex(rlp.encode(tx));
  console.log(encode_tx);
  if (encode_tx == rawTxByte){
    console.log(true)
  } else{
    console.log(false)
  }

  describe('tx test', () => {
    before(async () => {
      txTest = await TransactionTest.new();
      rlpTest = await RLPEncodeTest.new();
    });

    it('rlp test', async () => {
      const encodedNonce = await rlpTest.encodeUint(nonce);
      const encodedGasPrice = await rlpTest.encodeUint(gasPrice);
      const encodedGas = await rlpTest.encodeUint(gas);
      const encodedTo = await rlpTest.encodeAddress(to);
      const encodedValue = await rlpTest.encodeUint(value);
      const encodedData = await rlpTest.encodeBytes(input);
      const encodedV = await rlpTest.encodeUint(v);
      const encodedR = await rlpTest.encodeUint(r);
      const encodedS = await rlpTest.encodeUint(s);
      // const tx_list = await rlpTest._encodeList(encodedNonce, encodedGasPrice, encodedGas, encodedTo, encodedValue, encodedData, encodedV, encodedR, encodedS);
      // const tx_lists = await rlpTest.encodeList([encodedNonce, encodedGasPrice, encodedGas, encodedTo, encodedValue, encodedData, encodedV, encodedR, encodedS]);
      // const tx_bytes = await rlpTest.encodeBytes(tx_list);

      console.log(encodedNonce, encodedGasPrice, encodedGas, encodedTo, encodedValue, encodedData, encodedV, encodedR, encodedS);
      // console.log(tx_list);
      // console.log(tx_lists);
      // console.log(concat_byte.length)
      // console.log(tx_bytes)
    });



    it('get transaction', async () => {
      const rawTx = await txTest.hash(nonce, gasPrice, gas, to, value, input, v, r, s);
      console.log(rawTx);
      // assert.equal(await txTest.hash(nonce, gasPrice, gas, to, value, input, v, r, s), rawTxByte)
    });
  });
});
