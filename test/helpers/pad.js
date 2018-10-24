const { marshalString, unmarshalString } = require('./marshal');

const DEFAULT_PAD_LENGTH = 2 * 32;

function padLeft (str, padLength = DEFAULT_PAD_LENGTH) {
  const v = web3.toHex(str);
  return marshalString(web3.padLeft(unmarshalString(v), padLength));
}

function padRight (str, padLength = DEFAULT_PAD_LENGTH) {
  const v = web3.toHex(str);
  return marshalString(web3.padRight(unmarshalString(v), padLength));
}

module.exports = {
  padLeft,
  padRight,
};
