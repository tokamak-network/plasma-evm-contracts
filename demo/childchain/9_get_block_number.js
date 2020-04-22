module.exports = async function (callback) {
  try {
    const currentBlockNumber = await web3.eth.getBlockNumber();
    console.log(`currentBlockNumber: ${currentBlockNumber}`);
  } catch (err) {
    console.error(err.message);
  } finally {
    callback();
  }
};
