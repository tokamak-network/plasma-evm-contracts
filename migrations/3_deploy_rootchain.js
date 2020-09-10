const EpochHandler = artifacts.require('EpochHandler.sol');
const SubmitHandler = artifacts.require('SubmitHandler.sol');
const RootChain = artifacts.require('RootChain.sol');
const EtherToken = artifacts.require('EtherToken.sol');
const RootChainRegistry = artifacts.require('RootChainRegistry');
const axios = require('axios');
const fs = require('fs');

const development = process.env.NODE_ENV !== 'production';

const NRBEpochLength = process.env.NRB_EPOCH_LENGTH || 2;
const statesRoot = '0xdb431b544b2f5468e3f771d7843d9c5df3b4edcf8bc1c599f18f0b4ea8709bc3';
const transactionsRoot = '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421';
const receiptsRoot = '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421';

module.exports = async function (deployer, network) {
  // skip production network
  if (process.env.SET_OPERATOR) {
    let rootchain;
    let epochHandler;
    const data = JSON.parse(fs.readFileSync('managers.json').toString());
    // const managers = {
    //   TON: '0x3734E35231abE68818996dC07Be6a8889202DEe9',
    //   WTON: '0x6c6079EF61F4128639607EA10FE3D8FDDB41F781',
    //   RootChainRegistry: '0xF7dbB432b68295329790EF81fedE861645969112',
    //   DepositManager: '0x537111FA5F7188aFA996ed73b273D17EEfc3F866',
    //   SeigManager: '0x0ed93958871Cd9512d5de65CFeb6f4837c0d5B17',
    //   PowerTON: '0xc144aC1bC0F85A01B1e3Ce93789EB3f516f245eB',
    // };

    await deployer.deploy(EpochHandler)
      .then((_epochHandler) => { epochHandler = _epochHandler; })
      .then(() => deployer.deploy(
        SubmitHandler,
        epochHandler.address,
      )).then((submitHandler) => deployer.deploy(
        RootChain,
        epochHandler.address,
        submitHandler.address,
        EtherToken.address,
        development,
        NRBEpochLength,
        statesRoot,
        transactionsRoot,
        receiptsRoot))
      .then(async () => { rootchain = await RootChain.deployed(); })
      .then(() => rootchain.setSeigManager(data.SeigManager))
      .catch(e => { throw e; });
  }
};
