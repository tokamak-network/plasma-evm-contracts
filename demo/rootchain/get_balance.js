const config = require('../config');
const RequestableSimpleToken = artifacts.require('RequestableSimpleToken.sol');

module.exports = async function (callback) {
  try {
    const token = await RequestableSimpleToken.at(config.tokenAtRootChain);
    const balance = await token.balances(config.tokenHolder);
    console.log(balance.toString());

    callback();
  } catch (err) {
    console.error(err.message);
  }
};
