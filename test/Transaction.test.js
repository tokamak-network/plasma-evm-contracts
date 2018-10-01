const TransactionTest = artifacts.require("TransactionTest")
const RLPEncodeTest = artifacts.require("RLPEncodeTest")

const abi = require('ethereumjs-abi')
const BN = require('bn.js')

contract("TransactionTest", async (accounts) => {

  let [
    account1,
    account2
  ] = accounts

  before('#create instance', async () => {
    transactionTest = await TransactionTest.deployed()
    rlpEncodeTest = await RLPEncodeTest.deployed()
  })

  describe("#RLP-encoding", async () => {
    const nonce = 1
    const gasPrice = 10
    const gasLimit = 100
    const to = 0x43989fb883ba8111221e89123897538475893837
    const value = 1000
    const data = 0x11
    const v = 1
    const r = 10
    const s = 100

    it("it should be equal to hash value", async () => {
      const value1 = await transactionTest.encodeTX(
        nonce,
        gasPrice,
        gasLimit,
        to,
        value,
        data,
        v,
        r,
        s,
        {from: account1}
      )

      const RLPnonce = await rlpEncodeTest.encodeUint(nonce, {from: account1})
      const RLPgasPrice = await rlpEncodeTest.encodeUint(gasPrice, {from: account1})
      const RLPgasLimit = await rlpEncodeTest.encodeUint(gasLimit, {from: account1})
      const RLPto = await rlpEncodeTest.encodeAddress(to, {from: account1})
      const RLPvalue = await rlpEncodeTest.encodeAddress(value, {from: account1})
      const RLPdata = await rlpEncodeTest.encodeBytes(data, {from: account1})
      const RLPv = await rlpEncodeTest.encodeUint8(v, {from: account1})
      const RLPr = await rlpEncodeTest.encodeUint(r, {from: account1})
      const RLPs = await rlpEncodeTest.encodeUint(s, {from: account1})

      

      //assert.equal(value1, value2)

    })

  })

})
