const EpochHandler = artifacts.require('EpochHandler.sol');
const SubmitHandler = artifacts.require('SubmitHandler.sol');
const Layer2 = artifacts.require('Layer2.sol');
const EtherToken = artifacts.require('EtherToken.sol');
const Layer2Registry = artifacts.require('Layer2Registry');
const axios = require('axios');
const fs = require('fs');

const development = process.env.NODE_ENV !== 'production';

const NRBEpochLength = process.env.NRB_EPOCH_LENGTH || 2;
const statesRoot = '0xdb431b544b2f5468e3f771d7843d9c5df3b4edcf8bc1c599f18f0b4ea8709bc3';
const transactionsRoot = '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421';
const receiptsRoot = '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421';

module.exports = async function (deployer, network) {
  if (process.env.REGISTER) {
    // process.env.chainid &&
    // process.env.Layer2 &&
    // process.env.operator_name &&
    // process.env.website &&
    // process.env.description
    const data = JSON.parse(fs.readFileSync('deployed.json').toString());
    const layer2 = await Layer2.at(process.env.layer2);

    await layer2.setSeigManager(data.SeigManager);

    const registry = await Layer2Registry.at(data.Layer2Registry);

    // register root chain and deploy coinage
    await registry.registerAndDeployCoinage(layer2.address, data.SeigManager);

    await axios.post('http://localhost:9002/operators', {
      genesis: {
        config: {
          chainId: process.env.chainid,
        },
        extraData: process.env.layer2,
      },
      name: process.env.operator_name,
      website: process.env.website,
      description: process.env.description,
    }).then(function (response) {
      console.log(response);
    }).catch(function (err) {
      console.log(err);
    });
    // await layer2.changeOperator();
  }
};
