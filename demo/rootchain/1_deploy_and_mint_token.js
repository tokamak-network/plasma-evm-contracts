const config = require('../config');
const RequestableSimpleToken = artifacts.require('RequestableSimpleToken.sol');

module.exports = async function (callback) {
  try {
    const tokenAmount = web3.utils.toWei('5', 'ether');

    const token = await RequestableSimpleToken.new({
      from: config.operator,
    });
    await token.mint(config.tokenHolder, tokenAmount, {
      from: config.operator,
    });
    console.log(token.address);
  } catch (err) {
    console.error(err.message);
  } finally {
    callback();
  }
};
