require('dotenv').config();

const PrivateKeyProvider = require('truffle-privatekey-provider');
const privateKey = process.env.OPERATOR_PRIV_KEY || '';

const providerUrl = 'http://localhost:8545';

module.exports = {
  networks: {
    development: {
      provider: new PrivateKeyProvider(privateKey, providerUrl),
      gas: 6500000,
      // gas: 10000000,
      gasPrice: 1e9,
      network_id: '*', // eslint-disable-line camelcase
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
  },
  solc: {
    optimizer: {
      enabled: true,
      runs: 200,
    },
  },
};
