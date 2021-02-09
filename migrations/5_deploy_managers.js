const { createCurrency } = require('@makerdao/currency');
const fs = require('fs');
const { deployedOrDeploy } = require('../utils/deploy');

const _WTON = createCurrency('WTON');

const Layer2 = artifacts.require('Layer2');
const TON = artifacts.require('TON');
const WTON = artifacts.require('WTON');
const Layer2Registry = artifacts.require('Layer2Registry');
const DepositManager = artifacts.require('DepositManager');
const SeigManager = artifacts.require('SeigManager');
const CoinageFactory = artifacts.require('CoinageFactory');
const PowerTON = artifacts.require('PowerTON');
const DAOVault = artifacts.require('DAOVault');

// 1024 blocks
// 93046 blocks (= 2 weeks)
const WITHDRAWAL_DELAY_DEFAULT = 93046;
const WITHDRAWAL_DELAY_MAINNET = 93046;
const WITHDRAWAL_DELAY_RINKEBY = Math.floor(WITHDRAWAL_DELAY_MAINNET / (14 * 24 * 2)); // 30 min

// 1209600 sec (= 2 weeks)
const ROUND_DURATION_DEFAULT = 1209600;
const ROUND_DURATION_MAINNET = 1209600;
const ROUND_DURATION_RINKEBY = Math.floor(ROUND_DURATION_MAINNET / (14 * 24 * 2)); // 30 min

// 100 WTON per block as seigniorage
const SEIG_PER_BLOCK = process.env.SEIG_PER_BLOCK || '3.92';

const TON_MAINNET = '0x2be5e8c109e2197d077d13a82daead6a9b3433c5';
const TON_RINKEBY = '0x3734E35231abE68818996dC07Be6a8889202DEe9';

module.exports = async function (deployer, network) {
  if (process.env.DEPLOY) {
    // rinkeby TON: 0x3734E35231abE68818996dC07Be6a8889202DEe9, mainnet TON: 0x2be5e8c109e2197d077d13a82daead6a9b3433c5
    const tonAddr = network.includes('mainnet')
      ? TON_MAINNET : network.includes('rinkeby')
        ? TON_RINKEBY
        : undefined;

    const withdrawalDelay = network.includes('mainnet')
      ? WITHDRAWAL_DELAY_MAINNET : network.includes('rinkeby')
        ? WITHDRAWAL_DELAY_RINKEBY
        : WITHDRAWAL_DELAY_DEFAULT;

    const roundDuration = network.includes('mainnet')
      ? ROUND_DURATION_MAINNET : network.includes('rinkeby')
        ? ROUND_DURATION_RINKEBY
        : ROUND_DURATION_DEFAULT;

    console.log('Using TON deployed at', tonAddr);

    let ton = null;
    if (tonAddr) {
      ton = await TON.at(tonAddr);
    } else {
      ton = await deployedOrDeploy(TON, deployer);
    }

    let wton;
    let registry;
    let depositManager;
    let factory;
    let daoVault;
    let seigManager;
    let powerton;

    let addrs = {};
    addrs = JSON.parse(fs.readFileSync('deployed.json').toString());
    addrs.TON = ton.address;
    fs.writeFileSync('deployed.json', JSON.stringify(addrs));

    if (process.env.wton) {
      addrs = JSON.parse(fs.readFileSync('deployed.json').toString());
      await deployer.deploy(WTON, ton.address);
      wton = await WTON.deployed();
      addrs.WTON = wton.address;
      fs.writeFileSync('deployed.json', JSON.stringify(addrs));
    }

    if (process.env.registry) {
      addrs = JSON.parse(fs.readFileSync('deployed.json').toString());
      await deployer.deploy(Layer2Registry);
      registry = await Layer2Registry.deployed();
      addrs.Layer2Registry = registry.address;
      fs.writeFileSync('deployed.json', JSON.stringify(addrs));
    }

    if (process.env.deposit) {
      addrs = JSON.parse(fs.readFileSync('deployed.json').toString());
      console.log(addrs.WTON, addrs.Layer2Registry, withdrawalDelay)
      await deployer.deploy(
        DepositManager,
        addrs.WTON,
        addrs.Layer2Registry,
        withdrawalDelay,
      );
      depositManager = await DepositManager.deployed();
      addrs.DepositManager = depositManager.address;
      fs.writeFileSync('deployed.json', JSON.stringify(addrs));
    }

    if (process.env.factory) {
      addrs = JSON.parse(fs.readFileSync('deployed.json').toString());
      await deployer.deploy(CoinageFactory);
      factory = await CoinageFactory.deployed();
      addrs.Factory = factory.address;
      fs.writeFileSync('deployed.json', JSON.stringify(addrs));
    }

    if (process.env.daoVault) {
      addrs = JSON.parse(fs.readFileSync('deployed.json').toString());
      await deployer.deploy(DAOVault, addrs.WTON, 1609416000);
      daoVault = await DAOVault.deployed();
      addrs.DaoVault = daoVault.address;
      fs.writeFileSync('deployed.json', JSON.stringify(addrs));
    }

    if (process.env.seig) {
      addrs = JSON.parse(fs.readFileSync('deployed.json').toString());
      await deployer.deploy(
        SeigManager,
        addrs.TON,
        addrs.WTON,
        addrs.Layer2Registry,
        addrs.DepositManager,
        _WTON(SEIG_PER_BLOCK).toFixed('ray'),
        addrs.Factory,
      );
      seigManager = await SeigManager.deployed();
      addrs.SeigManager = seigManager.address;
      fs.writeFileSync('deployed.json', JSON.stringify(addrs));
    }

    if (process.env.powerton) {
      addrs = JSON.parse(fs.readFileSync('deployed.json').toString());
      await deployer.deploy(
        PowerTON,
        addrs.SeigManager,
        addrs.WTON,
        roundDuration,
      );
      powerton = await PowerTON.deployed();
      addrs.PowerTON = powerton.address;
      fs.writeFileSync('deployed.json', JSON.stringify(addrs));
    }

    console.log(JSON.stringify(addrs, null, 2));
  }
};
