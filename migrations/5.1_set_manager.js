const { createCurrency } = require('@makerdao/currency');
const fs = require('fs');

const _WTON = createCurrency('WTON');

const RootChain = artifacts.require('RootChain');
const TON = artifacts.require('TON');
const WTON = artifacts.require('WTON');
const RootChainRegistry = artifacts.require('RootChainRegistry');
const DepositManager = artifacts.require('DepositManager');
const SeigManager = artifacts.require('SeigManager');
const CoinageFactory = artifacts.require('CoinageFactory');
const PowerTON = artifacts.require('PowerTON');

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
  if (process.env.SET) {
    const data = JSON.parse(fs.readFileSync('deployed.json').toString());
    const seigManager = await SeigManager.at(data.SeigManager);
    const wton = await WTON.at(data.WTON);
    const powerton = await PowerTON.at(data.PowerTON);
    const depositManager = await DepositManager.at(data.DepositManager);

    const factory = await deployer.deploy(CoinageFactory);
    await seigManager.setCoinageFactory(factory.address);
    await factory.setSeigManager(seigManager.address);

    console.log('Initialize PowerTON...');
    await powerton.init();

    console.log('Set PowerTON to SeigManager...');
    await seigManager.setPowerTON(powerton.address);

    // add WTON minter role to seig manager
    console.log('Add WTON Minter Role to SeigManager...');
    await wton.addMinter(seigManager.address);

    // set seig manager to contracts
    console.log('Set SeigManager to WTON and DepositManager...');
    await Promise.all([
      depositManager,
      wton,
    ].map(contract => contract.setSeigManager(seigManager.address)));

    console.log('Start PowerTON...');
    await powerton.start();
  }
}
;
