const config = require('../config');
const RootChain = artifacts.require('RootChain.sol');

module.exports = async function (callback) {
  try {
    const rootchain = await RootChain.at(config.rootchain);
    const tx = await rootchain.mapRequestableContractByOperator(
      config.tokenAtRootChain,
      config.tokenAtChildChain,
      {
        from: config.operator,
      },
    );
    if (tx.receipt.status) {
      console.log('success');
    }
  } catch (err) {
    console.error(err.message);
  } finally {
    callback();
  }
};