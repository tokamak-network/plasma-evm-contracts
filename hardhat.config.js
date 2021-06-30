require('@nomiclabs/hardhat-waffle');
require('@eth-optimism/hardhat-ovm');

module.exports = {
  networks: {
    optimism: {
      url: 'http://127.0.0.1:8545',
      // This sets the gas price to 0 for all transactions on L2. We do this
      // because account balances are not automatically initiated with an ETH
      // balance (yet, sorry!).
      gasPrice: 0,
      ovm: true, // This sets the network as using the ovm and ensure contract will be compiled against that.
    },
  },
  solidity: {
    version: '0.5.12',
    settings: {
      optimizer: {
        enabled: true,
        runs: 1000,
      },
    },
  },
};
