const MintableToken = artifacts.require('MintableToken.sol');
const EtherToken = artifacts.require('EtherToken.sol');
const EpochHandler = artifacts.require('EpochHandler.sol');
const RootChain = artifacts.require('RootChain.sol');

const swapEnabled = true;
const development = process.env.NODE_ENV !== 'production';
const NRBEpochLength = process.env.NRB_EPOCH_LENGTH || 2;
const statesRoot = '0x0ded2f89db1e11454ba4ba90e31850587943ed4a412f2ddf422bd948eae8b164';
const transactionsRoot = '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421';
const receiptsRoot = '0x000000000000000000000000000000000000000000000000000000000000dead';

module.exports = function (deployer) {
  deployer.deploy(MintableToken)
    .then(token => deployer.deploy(EtherToken, development, token.address, swapEnabled)
      .then(etherToken => deployer.deploy(EpochHandler)
        .then(epochHandler => deployer.deploy(
          RootChain,
          epochHandler.address,
          etherToken.address,
          development,
          NRBEpochLength,
          statesRoot,
          transactionsRoot,
          receiptsRoot))
        .catch(e => { throw e; })));
};
