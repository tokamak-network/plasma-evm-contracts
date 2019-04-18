const Web3 = require('web3');
const fs = require('fs');
const path = require('path');

const web3Root = new Web3(new Web3.providers.HttpProvider("http://localhost:8545"));
const web3Child = new Web3(new Web3.providers.HttpProvider("http://localhost:8547"));

const rootchainJSON = path.join(__dirname, 'RootChain.json');
const rootchainABI = JSON.parse(fs.readFileSync(rootchainJSON).toString()).abi;

const RootChain = web3Root.eth.contract(rootchainABI);
const RootChainIns = RootChain.at('0x154C5E3762FbB57427d6B03E7302BDA04C497226');

//use bluebird
const Promise = require('bluebird');
Promise.promisifyAll(web3Root.eth, { suffix: 'Async' });
Promise.promisifyAll(web3Child.eth, { suffix: 'Async' });

setInterval(() => {
  web3Child.eth.sendTransaction({from:web3Child.eth.accounts[0], to:web3Child.eth.accounts[1], value:1}, (e,r) => {
    console.log(r);
  });
},20000);

let event = RootChainIns.BlockSubmitted({toBlock: 'latest'});

let timer = false;
event.watch(function(error, result){

   if (!error) {
     if(timer){
       clearInterval(timer);
       timer = false;
     } else {
       timer = setInterval(() => {
         web3Root.eth.getTransaction(result.transactionHash, (e,r) => {
           console.log(result.transactionHash, r.blockNumber);
         });
       }, 1000);
     }
    }
});
