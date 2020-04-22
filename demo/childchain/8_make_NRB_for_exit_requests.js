const config = require('../config');

module.exports = async function (callback) {
  try {
    for (let i = 0; i < config.NRELength * 2; i++) {
      await web3.eth.sendTransaction({
        from: config.operator,
        to: config.operator,
        value: 0,
      });
      console.log(`make ${i + 1} NRB`);
    }
  } catch (err) {
    console.error(err.message);
  } finally {
    callback();
  }
};
