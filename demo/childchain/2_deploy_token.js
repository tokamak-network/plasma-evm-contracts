const config = require('../config');
const RequestableSimpleToken = artifacts.require('RequestableSimpleToken.sol');

module.exports = async function (callback) {
  try {
    const token = await RequestableSimpleToken.new({
      from: config.operator,
    });
    console.log(token.address);
  } catch (err) {
    console.error(err.message);
  } finally {
    callback();
  }
};
