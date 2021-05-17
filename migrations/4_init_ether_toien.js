const Layer2 = artifacts.require('Layer2.sol');
const EtherToken = artifacts.require('EtherToken.sol');

module.exports = async function (deployer, network) {
  // skip production network
  if (network.includes('faraday') || network.includes('mainnet') || network.includes('rinkeby') || network.includes('development')) return;

  const etherToken = await EtherToken.deployed();
  const layer2 = await Layer2.deployed();

  await etherToken.init(layer2.address);
};
