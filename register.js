const axios = require('axios');

axios.post('http://dashboard-api.tokamak.network/operators', {
  genesis: {
    config: {
      chainId: process.env.chainid,
    },
    extraData: process.env.layer2,
  },
  name: process.env.operator_name,
  website: process.env.website,
  description: process.env.description,
}).then(function (response) {
  console.log(response);
}).catch(function (err) {
  console.log(err);
});
