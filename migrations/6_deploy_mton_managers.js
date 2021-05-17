const { createCurrency } = require('@makerdao/currency');

const _MTON = createCurrency('MTON');
const _WTON = createCurrency('WTON');

const TON = artifacts.require('TON.sol');
const MTON = artifacts.require('MTON.sol');
const WTON = artifacts.require('WTON.sol');
const Layer2Registry = artifacts.require('Layer2Registry.sol');
const DepositManager = artifacts.require('DepositManager.sol');
const SeigManager = artifacts.require('SeigManager.sol');
const PowerTON = artifacts.require('PowerTON.sol');

// 93046 blocks (= 2 weeks)
const WITHDRAWAL_DELAY_MAINNET = 93046;
const WITHDRAWAL_DELAY_RINKEBY = Math.floor(WITHDRAWAL_DELAY_MAINNET / (14 * 24 * 2)); // 30 min

// 1209600 sec (= 2 weeks)
const ROUND_DURATION_MAINNET = 1209600;
const ROUND_DURATION_RINKEBY = Math.floor(ROUND_DURATION_MAINNET / (14 * 24 * 2)); // 30 min

// 0.1236681887366820 WTON per block as seigniorage --> 20% of MTON initial supply
const SEIG_PER_BLOCK = '0.1236681887366820';

const MTON_MAINNET = process.env.MTON_MAINNET;
const MTON_RINKEBY = process.env.MTON_RINKEBY;

module.exports = async function (deployer, network) {
  // only deploy at mainnet or rinkeby testnet
  if (network.includes('mainnet') || network.includes('rinkeby') || network.includes('development')) return;

  const mtonAddr = network.includes('mainnet')
    ? MTON_MAINNET : network.includes('rinkeby')
      ? MTON_RINKEBY
      : undefined;

  const withdrawalDelay = network.includes('mainnet')
    ? WITHDRAWAL_DELAY_MAINNET : network.includes('rinkeby')
      ? WITHDRAWAL_DELAY_RINKEBY
      : undefined;

  const roundDuration = network.includes('mainnet')
    ? ROUND_DURATION_MAINNET : network.includes('rinkeby')
      ? ROUND_DURATION_RINKEBY
      : undefined;

  console.log('Using MTON deployed at', mtonAddr);

  const mton = mtonAddr ? await MTON.at(mtonAddr) : await deployer.deploy(MTON);

  const wton = await deployer.deploy(WTON, mton.address);
  const registry = await deployer.deploy(Layer2Registry);

  const depositManager = await deployer.deploy(
    DepositManager,
    wton.address,
    registry.address,
    withdrawalDelay,
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
    roundDuration,
  );

  const addrs = {
    TON: mton.address,
    WTON: wton.address,
    Layer2Registry: registry.address,
    DepositManager: depositManager.address,
    SeigManager: seigManager.address,
    PowerTON: powerton.address,
  };

  console.log(JSON.stringify(addrs, null, 2));

  console.log('Initialize PowerTON...');
  await powerton.init();

  console.log('Set PowerTON to SeigManager...');
  await seigManager.setPowerTON(powerton.address);

  // add minter roles
  console.log('Add WTON Minter Role to SeigManager...');
  await wton.addMinter(seigManager.address);

  console.log('Add MTON Minter Role to WTON...');
  await mton.addMinter(wton.address);

  // set seig manager to contracts
  console.log('Set SeigManager to WTON and DepositManager...');
  await Promise.all([
    depositManager,
    wton,
  ].map(contract => contract.setSeigManager(seigManager.address)));

  console.log('Start PowerTON...');
  await powerton.start();
};
