const TransactionTest = artifacts.require("TransactionTest")

module.exports = function(deployer) {
  deployer.deploy(TransactionTest)
}
