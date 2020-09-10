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

module.exports = async function (deployer, network) {
  // skip production network
  if (process.env.SET_OPERATOR) {
    let layer2;
    let epochHandler;
    const data = JSON.parse(fs.readFileSync('deployed.json').toString());

    await deployer.deploy(EpochHandler)
      .then((_epochHandler) => { epochHandler = _epochHandler; })
      .then(() => deployer.deploy(
        SubmitHandler,
        epochHandler.address, // TODO: handler remove
      )).then((submitHandler) => deployer.deploy(
        Layer2,
        epochHandler.address, // TODO: 0x000
        submitHandler.address, // TODO: 0x000
        EtherToken.address,
        development,
        NRBEpochLength,
        statesRoot,
        transactionsRoot,
        receiptsRoot))
      .then(async () => { layer2 = await Layer2.deployed(); })
      .then(() => layer2.setSeigManager(data.SeigManager))
      .catch(e => { throw e; });

    await layer2.setSeigManager(data.SeigManager);
    const registry = await Layer2Registry.at(data.Layer2Registry);

    // register root chain and deploy coinage
    await registry.registerAndDeployCoinage(layer2.address, data.SeigManager);

    await axios.post('http://localhost:9002/operators', {
      genesis: {
        config: {
          chainId: process.env.chainid,
        },
        extraData: layer2.address,
      },
      name: process.env.operator_name,
      website: process.env.website,
      description: process.env.description,
    }).then(function (response) {
      console.log(response);
    }).catch(function (err) {
      console.log(err);
    });
  }
};
