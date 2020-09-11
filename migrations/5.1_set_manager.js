const { createCurrency } = require('@makerdao/currency');
const fs = require('fs');

const TON = artifacts.require('TON');
const WTON = artifacts.require('WTON');
const DepositManager = artifacts.require('DepositManager');
const SeigManager = artifacts.require('SeigManager');
const CoinageFactory = artifacts.require('CoinageFactory');
const PowerTON = artifacts.require('PowerTON');
const DAOVault = artifacts.require('DAOVault');

module.exports = async function (deployer, network) {
  if (process.env.SET) {
    const data = JSON.parse(fs.readFileSync('deployed.json').toString());
    const seigManager = await SeigManager.at(data.SeigManager);
    const wton = await WTON.at(data.WTON);
    const powerton = await PowerTON.at(data.PowerTON);
    const depositManager = await DepositManager.at(data.DepositManager);
    const ton = await TON.at(data.TON);

    const factory = await CoinageFactory.at(data.Factory);
    const daoVault = await DAOVault.at(data.DaoVault);

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
  }
};
