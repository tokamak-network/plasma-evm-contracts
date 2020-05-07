require('dotenv').config();

const PrivateKeyProvider = require('truffle-privatekey-provider');

const FARADAY_URL = 'https://api.faraday.tokamak.network';
const FARADAY_PRIVATEKEY = process.env.FARADAY_PRIVATEKEY;

const RINKEBY_URL = 'http://13.231.233.189:8545';
const RINKEBY_OPERATOR_PRIVATEKEY = 'process.env.RINKEBY_OPERATOR_PRIVATEKEY';
const RINKEBY_TOKEN_HOLDER_PRIVATEKEY = 'process.env.RINKEBY_TOKEN_HOLDER_PRIVATEKEY';

module.exports = {
  networks: {
    development: {
      host: 'localhost',
      port: 8545,
      gas: 7500000,
      gasPrice: 1e9,
      network_id: '*', // eslint-disable-line camelcase
    },
    rootchain: {
      host: 'localhost',
      port: 8545,
      gas: 7500000,
      gasPrice: 1e9,
      network_id: '*', // eslint-disable-line camelcase
    },
    childchain: {
      host: 'localhost',
      port: 8547,
      gas: 7500000,
      gasPrice: 1e9,
      network_id: '*', // eslint-disable-line camelcase
    },
    plasma: {
      host: 'localhost',
      port: 8547,
      gas: 7500000,
      gasPrice: 1e9,
      network_id: '*', // eslint-disable-line camelcase
    },
    faraday: {
      provider () {
        return new PrivateKeyProvider(FARADAY_PRIVATEKEY, FARADAY_URL);
      },
      gas: 7500000,
      gasPrice: 10e9,
      network_id: '*', // eslint-disable-line camelcase
    },
    rinkeby: {
      provider () {
        return new PrivateKeyProvider(RINKEBY_OPERATOR_PRIVATEKEY, RINKEBY_URL);
        // return new PrivateKeyProvider(RINKEBY_TOKEN_HOLDER_PRIVATEKEY, RINKEBY_URL);
      },
      gas: 7500000,
      gasPrice: 18e9, // 18 gwei
      network_id: 4, // eslint-disable-line camelcase
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
