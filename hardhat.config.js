require('@nomiclabs/hardhat-waffle');

module.exports = {
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
