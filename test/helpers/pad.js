const { marshalString, unmarshalString } = require('./marshal');

const DEFAULT_PAD_LENGTH = 2 * 32;

function padLeft (str, padLength = DEFAULT_PAD_LENGTH) {
  const v = web3.utils.toHex(str);
  return marshalString(web3.utils.padLeft(unmarshalString(v), padLength));
}

function padRight (str, padLength = DEFAULT_PAD_LENGTH) {
  const v = web3.utils.toHex(str);
  return marshalString(web3.utils.padRight(unmarshalString(v), padLength));
}

module.exports = {
  padLeft,
  padRight,
};
