const MintableToken = artifacts.require('MintableToken.sol');
const EtherToken = artifacts.require('EtherToken.sol');

const development = process.env.NODE_ENV !== 'production';

const baseTokenAddress = process.env.BASE_TOKEN || '0x0000000000000000000000000000000000000000';

const swapEnabled = true;

module.exports = function (deployer) {
  if (development || baseTokenAddress === '0x0000000000000000000000000000000000000000') {
    deployer.deploy(MintableToken)
      .then(token => deployer.deploy(EtherToken, development, token.address, swapEnabled))
      .catch(e => { throw e; });
  } else {
    deployer.deploy(EtherToken, development, baseTokenAddress, swapEnabled)
      .catch(e => { throw e; });
  }
};
