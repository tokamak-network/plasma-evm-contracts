const { marshalString, unmarshalString } = require("./marshal");

const DEFAULT_PAD_LENGTH = 2 * 32;

function padLeft(str, pad_length = DEFAULT_PAD_LENGTH) {
  const v = web3.toHex(str);
  return marshalString(web3.padLeft(unmarshalString(v), pad_length));
}

function padRight(str, pad_length = DEFAULT_PAD_LENGTH) {
  const v = web3.toHex(str);
  return marshalString(web3.padRight(unmarshalString(v), pad_length));
}

module.exports = {
  padLeft,
  padRight,
}
