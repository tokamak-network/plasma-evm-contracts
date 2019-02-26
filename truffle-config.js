require('dotenv').config();

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
      port: 8546,
      gas: 7500000,
      gasPrice: 1e9,
      network_id: '*', // eslint-disable-line camelcase
      websocket: true,
    },
    plasma: {
      host: '192.168.0.8',
      port: 8547,
      gas: 7500000,
      gasPrice: 1e9,
      network_id: '*', // eslint-disable-line camelcase
    },
    docker: {
      host: '192.168.0.8',
      port: 8545,
      gas: 7500000,
      gasPrice: 1e9,
      network_id: '*', // eslint-disable-line camelcase
      websocket: true,
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
  },
  solc: {
    optimizer: {
      enabled: true,
      runs: 200,
    },
  },
};
