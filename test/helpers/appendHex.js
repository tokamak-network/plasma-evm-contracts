const { marshalString, unmarshalString } = require('./marshal');

function appendHex (str1, str2) {
  return marshalString(unmarshalString(str1) + unmarshalString(str2));
}

module.exports = {
  appendHex,
};
