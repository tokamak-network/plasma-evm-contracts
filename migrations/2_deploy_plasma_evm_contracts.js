const { createCurrency } = require('@makerdao/currency');
const fs = require('fs');
const save = require('./save_deployed');
const load = require('./load_deployed');
const { toBN } = require('web3-utils');

const _WTON = createCurrency('WTON');

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
const WITHDRAWAL_DELAY_RINKEBY = Math.floor(WITHDRAWAL_DELAY_MAINNET / (14 * 24 * 6)); // 10 min

// 1209600 sec (= 2 weeks)
const ROUND_DURATION_MAINNET = 1209600;
const ROUND_DURATION_RINKEBY = Math.floor(ROUND_DURATION_MAINNET / (14 * 24 * 6)); // 10 min

// 100 WTON per block as seigniorage
const SEIG_PER_BLOCK = process.env.SEIG_PER_BLOCK || '3.92';

module.exports = async function (deployer, network) {
  let tonAddress, wtonAddress, registryAddress, depositManagerAddress, factoryAddress, daoVaultAddress, seigManagerAddress, powertonAddress;
  let ton;

  tonAddress = load(network, "TON");
  if (tonAddress === undefined) {
    console.log("deploy TON");
    await deployer.deploy(TON)
      .then((_ton) => {
        ton = _ton;
        tonAddress = ton.address;
      });
    save(
      network, {
        name: "TON",
        address: ton.address
      }
    );
  }

  let wton;
  let registry;
  let depositManager;
  let factory;
  let daoVault;
  let seigManager;
  let powerton;

  wtonAddress = load(network, "WTON");
  if (wtonAddress === undefined) {
    console.log("deploy WTON");
    await deployer.deploy(WTON, tonAddress)
      .then((_wton) => {
        wton = _wton;
        wtonAddress = wton.address;
      });
    save(
      network, {
        name: "WTON",
        address: wton.address
      }
    );
  }

  registryAddress = load(network, "Layer2Registry");
  if (registryAddress === undefined) {
    console.log("deploy Layer2Registry");
    await deployer.deploy(Layer2Registry)
      .then((_registry) => {
        registry = _registry;
        registryAddress = registry.address;
      });

    save(
      network, {
        name: "Layer2Registry",
        address: registry.address
      }
    );
  }

  depositManagerAddress = load(network, "DepositManager");
  if (depositManagerAddress === undefined) {
    console.log("deploy DepositManager");
    await deployer.deploy(
      DepositManager,
      wtonAddress,
      registryAddress,
      WITHDRAWAL_DELAY_RINKEBY,
    )
      .then((_depositManager) => {
        depositManager = _depositManager;
        depositManagerAddress = depositManager.address;
      });

    save(
      network, {
        name: "DepositManager",
        address: depositManager.address
      }
    );
  }

  factoryAddress = load(network, "CoinageFactory");
  if (factoryAddress === undefined) {
    console.log("deploy CoinageFactory");
    await deployer.deploy(CoinageFactory)
      .then((_factory) => {
        factory = _factory;
        factoryAddress = factory.address;
      });

    save(
      network, {
        name: "CoinageFactory",
        address: factory.address
      }
    );
  }

  daoVaultAddress = load(network, "DAOVault");
  if (daoVaultAddress === undefined) {
    console.log("deploy DAOVault");
    await deployer.deploy(DAOVault, wtonAddress, 1609416000)
      .then((_daoVault) => {
        daoVault = _daoVault;
        daoVaultAddress = daoVault.address;
      });

    save(
      network, {
        name: "DAOVault",
        address: daoVault.address
      }
    );
  }

  seigManagerAddress = load(network, "SeigManager");
  if (seigManagerAddress === undefined) {
    console.log("deploy SeigManager");
    await deployer.deploy(
      SeigManager,
      tonAddress,
      wtonAddress,
      registryAddress,
      depositManagerAddress,
      _WTON(SEIG_PER_BLOCK).toFixed('ray'),
      factoryAddress,
    )
      .then((_seigManager) => {
        seigManager = _seigManager;
        seigManagerAddress = seigManager.address;
      });

    save(
      network, {
        name: "SeigManager",
        address: seigManager.address
      }
    );
  }

  powertonAddress = load(network, "PowerTON");
  if (powertonAddress === undefined) {
    console.log("deploy PowerTON");
    await deployer.deploy(
      PowerTON,
      seigManagerAddress,
      wtonAddress,
      ROUND_DURATION_RINKEBY,
    )
      .then((_powerton) => {
        powerton = _powerton;
        powertonAddress = powerton.address;
      });

    save(
      network, {
        name: "PowerTON",
        address: powerton.address
      }
    );
  }

  depositManager = await DepositManager.at(depositManagerAddress);
  ton = await TON.at(tonAddress);
  wton = await WTON.at(wtonAddress);
  seigManager = await SeigManager.at(seigManagerAddress);
  await depositManager.setSeigManager(seigManagerAddress);
  await wton.setSeigManager(seigManagerAddress);
  await wton.addMinter(seigManagerAddress);
  await ton.addMinter(wtonAddress);

  await seigManager.setPowerTONSeigRate(toBN("100000000000000000000000000"));
  await seigManager.setDaoSeigRate(toBN("500000000000000000000000000"));
  await seigManager.setPseigRate(toBN("400000000000000000000000000"));
  await seigManager.setMinimumAmount(toBN("1000000000000000000000000000000"));
};
