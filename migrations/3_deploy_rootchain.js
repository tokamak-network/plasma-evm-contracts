const EpochHandler = artifacts.require('EpochHandler.sol');
const SubmitHandler = artifacts.require('SubmitHandler.sol');
const Layer2 = artifacts.require('Layer2.sol');
const EtherToken = artifacts.require('EtherToken.sol');
const Layer2Registry = artifacts.require('Layer2Registry');
const axios = require('axios');
const fs = require('fs');

const development = process.env.NODE_ENV !== 'production';
// '0xDAA727d4F222DcEc6DF6ce3397c47Dee7Eb277A2'
const zeroAddress = '0x0000000000000000000000000000000000000000';
const NRBEpochLength = process.env.NRB_EPOCH_LENGTH || 2;
const statesRoot = '0xdb431b544b2f5468e3f771d7843d9c5df3b4edcf8bc1c599f18f0b4ea8709bc3';
const transactionsRoot = '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421';
const receiptsRoot = '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421';
const etherToken = '0x5c642140A3b6fA39Dfd1AA9eBA6C5239F5c457D5';

module.exports = async function (deployer, network) {
  // skip production network
  if (process.env.SET_OPERATOR) {
    const data = JSON.parse(fs.readFileSync('deployed.json').toString());
    console.log(data);
    if (process.env.epoch) {
      addrs = JSON.parse(fs.readFileSync('l2.json').toString());
      await deployer.deploy(EpochHandler)
      .then((_epochHandler) => {
        epochHandler = _epochHandler;
        addrs.EpochHandler = epochHandler.address;
      })
      fs.writeFile('l2.json', JSON.stringify(addrs), (err) => {
        if (err) throw err;
      });
    }
    if (process.env.submit) {
      addrs = JSON.parse(fs.readFileSync('l2.json').toString());
      console.log(addrs);
      const submit = await deployer.deploy(
        SubmitHandler,
        addrs.EpochHandler
      ).then((submitHandler) => {
        addrs.SubmitHandler = submitHandler.address;
      })
      fs.writeFile('l2.json', JSON.stringify(addrs), (err) => {
        if (err) throw err;
      });
    }
    if (process.env.l2) {
      addrs = JSON.parse(fs.readFileSync('l2.json').toString());
      console.log(addrs);
      l2 = await deployer.deploy(
        Layer2,
        addrs.EpochHandler,
        addrs.SubmitHandler,
        etherToken,
        false,
        NRBEpochLength,
        statesRoot,
        transactionsRoot,
        receiptsRoot
      ).then((_layer2) => {
        layer2 = _layer2
        addrs.Layer2 = layer2.address;
      })
      fs.writeFile('l2.json', JSON.stringify(addrs), (err) => {
        if (err) throw err;
      });
    }
    if (process.env.setl2) {
      addrs = JSON.parse(fs.readFileSync('l2.json').toString());
      const layer2 = await Layer2.at(addrs.Layer2);
      const registry = await Layer2Registry.at(data.Layer2Registry);
      console.log('set seig manager...');
      await layer2.setSeigManager(data.SeigManager);
      console.log('register and deploy...');
      await registry.registerAndDeployCoinage(addrs.Layer2, data.SeigManager);
    }
  }
};
