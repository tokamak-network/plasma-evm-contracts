var TransactionTest = artifacts.require("./TransactionTest.sol");
var RLPEncodeTest = artifacts.require("./RLPEncodeTest.sol");

module.exports = function(deployer) {
  deployer.deploy(TransactionTest);
  deployer.deploy(RLPEncodeTest);
};