const EpochHandler = artifacts.require('EpochHandler.sol');
const RootChain = artifacts.require('RootChain.sol');

const development = true;
const NRBEpochLength = 2;
const statesRoot = '0x0ded2f89db1e11454ba4ba90e31850587943ed4a412f2ddf422bd948eae8b164';
const transactionsRoot = '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421';
const receiptsRoot = '0x0000000000000000000000000000000000000000000000000000000000000000';

module.exports = function (deployer) {
  deployer.deploy(EpochHandler)
    .then((epochHandler) => {
      return deployer.deploy(RootChain, epochHandler.address, development, NRBEpochLength, statesRoot, transactionsRoot, receiptsRoot);
    })
    .catch(console.error);
};
