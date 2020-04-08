const { createCurrency } = require('@makerdao/currency');

const _MTON = createCurrency('MTON');
const _WTON = createCurrency('WTON');

const TON = artifacts.require('TON.sol');
const MTON = artifacts.require('MTON.sol');
const WTON = artifacts.require('WTON.sol');
const RootChainRegistry = artifacts.require('RootChainRegistry.sol');
const DepositManager = artifacts.require('DepositManager.sol');
const SeigManager = artifacts.require('SeigManager.sol');
const PowerTON = artifacts.require('PowerTON.sol');

// 93046 blocks (= 2 weeks)
const WITHDRAWAL_DELAY = 93046;

// 1209600 sec (= 2 weeks)
const ROUND_DURATION = 1209600;

// 0.1236681887366820 WTON per block as seigniorage
const SEIG_PER_BLOCK = '0.1236681887366820';

const MTON_ADDRESS = process.env.MTON_MAINNET;

module.exports = async function (deployer, network) {
  // only deploy at mainnet
  if (network !== 'mainnet') return;

  const mton = await MTON.at(MTON_ADDRESS);

  console.log('mton.address', mton.address);

  const wton = await deployer.deploy(WTON, mton.address);
  const registry = await deployer.deploy(RootChainRegistry);

  const depositManager = await deployer.deploy(
    DepositManager,
    wton.address,
    registry.address,
    WITHDRAWAL_DELAY,
  );

  const seigManager = await deployer.deploy(
    SeigManager,
    mton.address,
    wton.address,
    registry.address,
    depositManager.address,
    _WTON(SEIG_PER_BLOCK).toFixed('ray'),
  );

  const powerton = await deployer.deploy(
    PowerTON,
    seigManager.address,
    wton.address,
    ROUND_DURATION,
  );

  await powerton.init();
  await seigManager.setPowerTON(powerton.address);

  // add minter roles
  await wton.addMinter(seigManager.address);
  await mton.addMinter(wton.address);

  // set seig manager to contracts
  await Promise.all([
    depositManager,
    wton,
  ].map(contract => contract.setSeigManager(seigManager.address)));

  await powerton.start();
};
