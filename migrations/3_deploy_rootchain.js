const EpochHandler = artifacts.require('EpochHandler.sol');
const SubmitHandler = artifacts.require('SubmitHandler.sol');
const RootChain = artifacts.require('RootChain.sol');
const EtherToken = artifacts.require('EtherToken.sol');
const RootChainRegistry = artifacts.require('RootChainRegistry');

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
    const managers = {
      TON: '0x3734E35231abE68818996dC07Be6a8889202DEe9',
      WTON: '0x5a4142a5E6CBc24802656A69E75635D5350501A5',
      RootChainRegistry: '0x3b0DAa352C0508C3cE156a75dF7Cc62636B5f822',
      DepositManager: '0xbF0fbB74C72a9F1F267FA6cFA229a8E962a4C50A',
      SeigManager: '0x8738B7D4FFFE950f77934CC9711478C036b475CA',
      PowerTON: '0xC87EEf91227a6e51A1C4D32C3734C628d3b893bc',
    };

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
      .then(() => rootchain.setSeigManager(managers.SeigManager))
      .catch(e => { throw e; });

    await rootchain.setSeigManager(managers.SeigManager);
    const registry = await RootChainRegistry.at(managers.RootChainRegistry);

    // register root chain and deploy coinage
    await registry.registerAndDeployCoinage(rootchain.address, managers.SeigManager);

    const operator = {
      name: process.env.operator_name,
      website: process.env.website,
      description: process.env.description,
      rootchain: rootchain.address,
      chainId: process.env.chainid,
      avatar: '',
      color: 'rgb(228,235,87)',
      genesis: {},
    };
    console.log(operator);
  }
};
