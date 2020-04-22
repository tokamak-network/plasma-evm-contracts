const config = require('../config');
const RootChain = artifacts.require('RootChain.sol');

module.exports = async function (callback) {
  try {
    const rootchain = await RootChain.at(config.rootchain);
    const forkNumber = 0;

    while (true) {
      const tx = await rootchain.finalizeBlock({
        from: config.operator,
      });
      if (!tx.receipt.status) {
        break;
      }
      console.log(`currentBlockNumber: ${config.currentBlockNumber}`);
      console.log(`lastFinalizedBlock: ${await rootchain.getLastFinalizedBlock(forkNumber)}\n`);
    }
  } catch (err) {
    console.log('success');
  } finally {
    callback();
  }
};
