const RootChain = artifacts.require('RootChain.sol');
const EtherToken = artifacts.require('EtherToken.sol');

module.exports = async function (deployer, network) {
  // skip production network
  if (network === 'faraday' || network === 'mainnet') return;

  const etherToken = await EtherToken.deployed();
  const rootchain = await RootChain.deployed();

  await etherToken.init(rootchain.address);
};
