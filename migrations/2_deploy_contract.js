const TransactionTest = artifacts.require("TransactionTest")
const RLPEncodeTest = artifacts.require("RLPEncodeTest")

module.exports = function(deployer) {
  deployer.deploy(TransactionTest).then(() => {
    return deployer.deploy(RLPEncodeTest)
  })
}
