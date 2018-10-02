const TransactionTest = artifacts.require("TransactionTest")

contract("TransactionTest", async (accounts) => {

  let [
    account1,
    account2
  ] = accounts

  before('#create instance', async () => {
    transactionTest = await TransactionTest.deployed()
  })

  describe("#RLP-encoding", async () => {

    const testHash = '0x08d549eaea5af0a98cb522840661dbe5ea87a1158e59918c4805c2209264431e'

    const nonce = 0x6
    const gasPrice= 0x2540be400
    const gasLimit = 0x5208
    const to = 0x7c23a65d25cc8486557c988f3c9a68c5b595dd10
    const value = 0x1a530c08cd7e780
    const data = 0x000
    const v = 0x25
    const r = 0x5fa8173448bb1884861d441d8a7f88f8308eaf83a50ad0f23806ce248c91feb
    const s = 0x497e1e0fa9f4a39bc43a6bc1b13387275169739f5b5cb94a77ec43371320f5a4

    it("it should be equal to hash value", async () => {
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
        {from: account1}
      )
      console.log(value1, testHash)
      //assert.equal(value1, testHash)

    })

  })

})
