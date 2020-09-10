require('dotenv').config();

const PrivateKeyProvider = require('truffle-privatekey-provider');
const pk = '2bdd21761a483f71054e14f5b827213567971c676928d9a1808cbfa4b7501200';

module.exports = {
  networks: {
    development: {
      host: 'localhost',
      port: 8545,
      gas: 10000000,
      gasPrice: 1e9,
      network_id: '*', // eslint-disable-line camelcase
    },
    rootchain: {
      host: 'localhost',
      port: 8546,
      gas: 7500000,
      gasPrice: 1e9,
      network_id: '*', // eslint-disable-line camelcase
      websocket: true,
    },
    plasma: {
      host: 'localhost',
      port: 8547,
      gas: 7500000,
      gasPrice: 1e9,
      network_id: '*', // eslint-disable-line camelcase
    },
    faraday: {
      provider: () => new PrivateKeyProvider(process.env.FARADAY_PRIVATE_KEY, process.env.FARADAY_PROVIDER_URL),
      network_id: 16, // eslint-disable-line camelcase
      production: true,
    },
    rinkeby: {
      provider: () => new PrivateKeyProvider(pk, 'https://rinkeby.infura.io/v3/a608d5cd0f1e42109d964abdffe5d8d9'),
      network_id: 4, // eslint-disable-line camelcase
      // gas: 5000000,
      gasPrice: 5e9,
      skipDryRun: true,
    },
    ropsten: {
      provider: () => new PrivateKeyProvider(process.env.ROPSTEN_PRIVATE_KEY, process.env.ROPSTEN_PROVIDER_URL),
      network_id: 3, // eslint-disable-line camelcase
      production: true,
    },
    mainnet: {
      provider: () => new PrivateKeyProvider(process.env.MAINNET_PRIVATE_KEY, process.env.MAINNET_PROVIDER_URL),
      network_id: 1, // eslint-disable-line camelcase
      gasPrice: 8e9,
      production: true,
    },
  //   ropsten: {
  //     provider: ropstenProvider,
  //     network_id: 3, // eslint-disable-line camelcase
  //   },
  //   coverage: {
  //     host: 'localhost',
  //     network_id: '*', // eslint-disable-line camelcase
  //     port: 8555,
  //     gas: 0xfffffffffff,
  //     gasPrice: 0x01,
  //   },
  //   ganache: {
  //     host: 'localhost',
  //     port: 8545,
  //     network_id: '*', // eslint-disable-line camelcase
  //   },
  },
  mocha: {
    reporter: 'eth-gas-reporter',
    reporterOptions: {
      currency: 'USD',
      gasPrice: 21,
    },
    useColors: true,
    enableTimeouts: false,
    bail: true,
  },
  compilers: {
    solc: {
      version: '0.5.12',
      settings: {
        optimizer: {
          enabled: true,
          runs: 200,
        },
      },
    },
  },
};
