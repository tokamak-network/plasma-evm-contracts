// https://docs.openzeppelin.com/test-environment/0.1/getting-started

module.exports = {
  accounts: {
    amount: 20, // Number of unlocked accounts
    ether: 100000, // Initial balance of unlocked accounts (in ether)
  },

  contracts: {
    type: 'truffle', // Contract abstraction to use: 'truffle' for @truffle/contract or 'web3' for web3-eth-contract
    defaultGas: 8e6, // Maximum gas for contract calls (when unspecified)

    // Options available since v0.1.2
    defaultGasPrice: 20e9, // Gas price for contract calls (when unspecified)
    artifactsDir: 'build/contracts', // Directory where contract artifacts are stored
  },

  blockGasLimit: 8e6, // Maximum gas per block
};
