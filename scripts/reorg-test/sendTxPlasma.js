const Web3 = require('web3');
const fs = require('fs');
const path = require('path');

const web3Root = new Web3(new Web3.providers.HttpProvider("http://localhost:8545"));
const web3Child = new Web3(new Web3.providers.HttpProvider("http://localhost:8547"));

const rootchainJSON = path.join(__dirname, 'RootChain.json');
const rootchainABI = JSON.parse(fs.readFileSync(rootchainJSON).toString()).abi;

const RootChain = web3Root.eth.contract(rootchainABI);
const RootChainIns = RootChain.at('0x880EC53Af800b5Cd051531672EF4fc4De233bD5d');

//use bluebird
const Promise = require('bluebird');
Promise.promisifyAll(web3Root.eth, { suffix: 'Async' });
Promise.promisifyAll(web3Child.eth, { suffix: 'Async' });

//test 1
(async () => {
  try {
    let rootAccounts = await web3Root.eth.getAccountsAsync();
    let plsAccounts = await web3Child.eth.getAccountsAsync();
    console.log(rootAccounts, plsAccounts)
    
  } catch (e) {
    console.log(e);
  }

})();
