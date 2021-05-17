const Layer2 = artifacts.require('Layer2.sol');
const { BN } = require('web3-utils');

module.exports = async function (deployer, network) {
  if (process.env.COMMIT) {
    const dummyBytes = '0xdb431b544b2f5468e3f771d7843d9c5df3b4edcf8bc1c599f18f0b4ea8709bc3';
    if (process.env.L2Address) {
      const layer2 = await Layer2.at(process.env.L2Address);

      const [
        costNRB,
        NRELength,
        currentForkNumber,
      ] = await Promise.all([
        layer2.COST_NRB(),
        layer2.NRELength(),
        layer2.currentFork(),
      ]);
      const fork = await layer2.forks(currentForkNumber);
      const epochNumber = parseInt(fork.lastEpoch) + 1;
      const startBlockNumber = parseInt(fork.lastBlock) + 1;
      const endBlockNumber = parseInt(startBlockNumber) + parseInt(NRELength) - 1;

      const pos1 = _makePos(currentForkNumber, epochNumber);
      const pos2 = _makePos(startBlockNumber, endBlockNumber);

      console.log('commit..');
      await layer2.submitNRE(pos1, pos2, dummyBytes, dummyBytes, dummyBytes, { value: costNRB });
    };
  };
};

function _makePos (v1, v2) {
  v1 = new BN(v1);
  v2 = new BN(v2);

  const a = v1.mul(new BN(2).pow(new BN(128)));
  return a.add(v2).toString();
};
