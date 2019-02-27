require('dotenv').config();
const HDWalletProvider = require("truffle-hdwallet-provider-privkey");
const privKeys = ["b71c71a67e1177ad4e901695e1b4b9ee17ae16c6668d313eac2f96dbcda3f291", '78ae75d1cd5960d87e76a69760cb451a58928eee7890780c352186d23094a115'];

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
      provider: () => {
        return new HDWalletProvider(privKeys, "http://172.30.1.23:8545", 0, 2);
      },
      gas: 7000000,
      gasPrice: 1e9,
      network_id: '*', // eslint-disable-line camelcase
    },
    plasma: {
      host: '172.30.1.23',
      port: 8547,
      gas: 7500000,
      gasPrice: 1e9,
      network_id: '*', // eslint-disable-line camelcase
    },
    docker: {
      host: "172.30.1.23",
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
