const TON = artifacts.require('TON.sol');
const EtherToken = artifacts.require('EtherToken.sol');

const { deployedOrDeploy } = require('../utils/deploy');

const development = process.env.NODE_ENV !== 'production';

const baseTokenAddress = process.env.BASE_TOKEN || '0x0000000000000000000000000000000000000000';

const swapEnabled = true;
module.exports = async function (deployer, network) {
  // skip production network
  if (
    network.includes('faraday') ||
    network.includes('mainnet') ||
    network.includes('rinkeby') ||
    network.includes('development')
  ) return;

  if (development || baseTokenAddress === '0x0000000000000000000000000000000000000000') {
    // await deployer.deploy(TON);
    const token = await deployedOrDeploy(TON, deployer);
    console.log({ token: await TON.at(token.address) });
    await deployer.deploy(EtherToken, development, token.address, swapEnabled);
  } else {
    await deployer.deploy(EtherToken, development, baseTokenAddress, swapEnabled);
  }
};
