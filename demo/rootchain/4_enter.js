const config = require('../config');
const RootChain = artifacts.require('RootChain.sol');
const RequestableSimpleToken = artifacts.require('RequestableSimpleToken.sol');

module.exports = async function (callback) {
  try {
    const rootchain = await RootChain.at(config.rootchain);
    const token = await RequestableSimpleToken.at(config.tokenAtRootChain);

    const tokenAmount = web3.utils.toWei('1', 'ether');
    const trieKey = await token.getBalanceTrieKey(config.tokenHolder);
    const trieValue = padLeft(tokenAmount);

    const txs = [];
    for (let i = 0; i < 5; i++) {
      txs.push(rootchain.startEnter(config.tokenAtRootChain, trieKey, trieValue, {
        from: config.tokenHolder,
      }));
    }
    await Promise.all(txs);
    console.log('make 5 enter requests');
  } catch (err) {
    console.error(err.message);
  } finally {
    callback();
  }
};

const DEFAULT_PAD_LENGTH = 2 * 32;

function padLeft (str, padLength = DEFAULT_PAD_LENGTH) {
  const v = web3.utils.toHex(str);
  return marshalString(web3.utils.padLeft(unmarshalString(v), padLength));
}

function marshalString (str) {
  if (str.slice(0, 2) === '0x') return str;
  return '0x'.concat(str);
}

function unmarshalString (str) {
  if (str.slice(0, 2) === '0x') return str.slice(2);
  return str;
}
