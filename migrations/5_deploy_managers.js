const { createCurrency } = require('@makerdao/currency');
const fs = require('fs');

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
const WITHDRAWAL_DELAY_MAINNET = 93046;
const WITHDRAWAL_DELAY_RINKEBY = Math.floor(WITHDRAWAL_DELAY_MAINNET / (14 * 24 * 2)); // 30 min

// 1209600 sec (= 2 weeks)
const ROUND_DURATION_MAINNET = 1209600;
const ROUND_DURATION_RINKEBY = Math.floor(ROUND_DURATION_MAINNET / (14 * 24 * 2)); // 30 min

// 100 WTON per block as seigniorage
const SEIG_PER_BLOCK = process.env.SEIG_PER_BLOCK || '3.91615931';

const TON_MAINNET = process.env.TON_MAINNET;
const TON_RINKEBY = process.env.TON_RINKEBY;

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
        : undefined;

    const roundDuration = network.includes('mainnet')
      ? ROUND_DURATION_MAINNET : network.includes('rinkeby')
        ? ROUND_DURATION_RINKEBY
        : undefined;

    console.log('Using TON deployed at', tonAddr);

    const ton = tonAddr ? await TON.at(tonAddr) : await deployer.deploy(TON);

    // const Layer2 = await Layer2.deployed();
    // const ton = await deployer.deploy(TON);
    // console.log(ton);
    const wton = await deployer.deploy(WTON, ton.address);
    const registry = await deployer.deploy(Layer2Registry);
    const depositManager = await deployer.deploy(
      DepositManager,
      wton.address,
      registry.address,
      withdrawalDelay,
    );
    const factory = await deployer.deploy(CoinageFactory);
    const daoVault = await deployer.deploy(DAOVault, ton.address, 0); // TODO: set timestamp parameter
    const seigManager = await deployer.deploy(
      SeigManager,
      ton.address,
      wton.address,
      registry.address,
      depositManager.address,
      _WTON(SEIG_PER_BLOCK).toFixed('ray'),
      factory.address,
    );

    const powerton = await deployer.deploy(
      PowerTON,
      seigManager.address,
      wton.address,
      roundDuration,
    );
    fs.writeFile('deployed.json', '{}', (err) => { if (err) throw err; });

    const addrs = {
      TON: ton.address,
      WTON: wton.address,
      Layer2Registry: registry.address,
      DepositManager: depositManager.address,
      SeigManager: seigManager.address,
      PowerTON: powerton.address,
    };
    fs.writeFile('deployed.json', JSON.stringify(addrs), (err) => {
      if (err) throw err;
    });

    console.log(JSON.stringify(addrs, null, 2));
  }
};
