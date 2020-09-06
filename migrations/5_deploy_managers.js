const { createCurrency } = require('@makerdao/currency');

const _WTON = createCurrency('WTON');

const RootChain = artifacts.require('RootChain.sol');
const TON = artifacts.require('TON.sol');
const WTON = artifacts.require('WTON.sol');
const RootChainRegistry = artifacts.require('RootChainRegistry.sol');
const DepositManager = artifacts.require('DepositManager.sol');
const SeigManager = artifacts.require('SeigManager.sol');
const CoinageFactory = artifacts.require('CoinageFactory.sol');

// 1024 blocks
const WITHDRAWAL_DELAY = process.env.WITHDRAWAL_DELAY || '0x400';

// 100 WTON per block as seigniorage
const SEIG_PER_BLOCK = process.env.SEIG_PER_BLOCK || '100.0';

module.exports = async function (deployer, network) {
  // skip production network
  if (network.includes('faraday') || network.includes('mainnet') || network.includes('rinkeby')) return;

  const rootchain = await RootChain.deployed();
  const ton = await TON.deployed();

  const wton = await deployer.deploy(WTON, ton.address);
  const registry = await deployer.deploy(RootChainRegistry);
  const depositManager = await deployer.deploy(
    DepositManager,
    wton.address,
    registry.address,
    WITHDRAWAL_DELAY,
  );
  const seigManager = await deployer.deploy(
    SeigManager,
    ton.address,
    wton.address,
    registry.address,
    depositManager.address,
    _WTON(SEIG_PER_BLOCK).toFixed('ray'),
  );

  const factory = await deployer.deploy(CoinageFactory);
  await seigManager.setCoinageFactory(factory.address);
  await factory.setSeigManager(seigManager.address);

  // add WSTON minter role to seig manager
  await wton.addMinter(seigManager.address);

  // set seig manager to contracts
  await Promise.all([
    depositManager,
    wton,
  ].map(contract => contract.setSeigManager(seigManager.address)));

  await rootchain.setSeigManager(seigManager.address);

  // register root chain and deploy coinage
  await registry.registerAndDeployCoinage(rootchain.address, seigManager.address);
};
