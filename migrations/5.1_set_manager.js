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
    const ton = await TON.at(data.TON);

    const factory = await CoinageFactory.at(data.Factory);
    await seigManager.setCoinageFactory(factory.address);
    // await factory.setSeigManager(seigManager.address);

    console.log('Initialize PowerTON...');
    await powerton.init();

    // await seigManager.setDao(daoVault.address); // TODO: to init?

    console.log('Set PowerTON to SeigManager...');
    await seigManager.setPowerTON(powerton.address);

    console.log('Set DAO to SeigManager...');
    await seigManager.setDao(data.DaoVault);
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

    await ton.addMinter(wton.address);

    // owner 권한 변경 transferOwnership
  }
}
;
