const EpochHandler = artifacts.require('EpochHandler.sol');
const SubmitHandler = artifacts.require('SubmitHandler.sol');
const RootChain = artifacts.require('RootChain.sol');
const EtherToken = artifacts.require('EtherToken.sol');

const development = process.env.NODE_ENV !== 'production';

const NRBEpochLength = process.env.NRB_EPOCH_LENGTH || 2;
const statesRoot = '0xdb431b544b2f5468e3f771d7843d9c5df3b4edcf8bc1c599f18f0b4ea8709bc3';
const transactionsRoot = '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421';
const receiptsRoot = '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421';

module.exports = function (deployer, network) {
  // skip production network
  if (network === 'faraday' || network === 'mainnet') return;

  let epochHandler;

  deployer.deploy(EpochHandler)
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
    .catch(e => { throw e; });
};
