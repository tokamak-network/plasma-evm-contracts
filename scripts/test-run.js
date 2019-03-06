const Promise = require('bluebird');
const program = require('commander');
const fs = require('fs');
const path = require('path');
const HDWalletProvider = require('truffle-hdwallet-provider');
const Web3 = require('web3');
const BigNumber = web3.BigNumber;

const { appendHex } = require('../test/helpers/appendHex');
const { marshalString, unmarshalString } = require('../test/helpers/marshal');

const abiPath = path.join(__dirname, '..', 'build', 'contracts', 'RequestableSimpleToken.json');
const abi = JSON.parse(fs.readFileSync(abiPath).toString()).abi;
const bytecode = JSON.parse(fs.readFileSync(abiPath).toString()).bytecode;
const abiPathRC = path.join(__dirname, '..', 'build', 'contracts', 'RootChain.json');
const abiRC = JSON.parse(fs.readFileSync(abiPathRC).toString()).abi;

const defaultRootChainURL = 'http://127.0.0.1:8545';
const defaultChildChainURL = 'http://127.0.0.1:8547';
const mnemonic = 'onther eth pls kevin zoe carl jace jason thomas jake aiden jin';

const web3c = new Web3(new Web3.providers.HttpProvider(defaultChildChainURL));
const provider = new HDWalletProvider(mnemonic, defaultRootChainURL, 0, 50);
const web3Provider = new Web3(provider);

// use bluebird
Promise.promisifyAll(web3.eth, { suffix: 'Async' });
Promise.promisifyAll(web3c.eth, { suffix: 'Async' });
Promise.promisifyAll(web3Provider.eth, { suffix: 'Async' });

const RequestableSimpleToken = artifacts.require('RequestableSimpleToken.sol');

const DEFAULT_PAD_LENGTH = 2 * 32;

const tokenAmount = new BigNumber(10e18);
const operator = web3.eth.accounts[0];
const users = web3.eth.accounts.slice(1, 5);

async function test1 (n) {
  // get rootchain address from child chain
  const rootchainAddr = await web3c.eth.rootchain();
  const rootchainContract = await web3.eth.contract(abiRC).at(rootchainAddr);
  console.log(`Rootchain address: ${rootchainAddr}`);

  // deploy requestable contract on rootchain
  const tokenAtRoot = await RequestableSimpleToken.new();
  console.log(`RequestSimpleToken address in rootchain:' ${tokenAtRoot.address}`);
  for (let i = 0; i < 4; i++) {
    const receipt = await tokenAtRoot.mint(users[i], tokenAmount.mul(100));
    await waitTx('Mint request simple token', receipt.tx);
  }

  const numEROs = await rootchainContract.getNumEROs();
  console.log(`number of EROs: ${numEROs.toNumber()}`);

  // send PETH in childchain
  await sendPETHfromOperator(1);
  console.log('finish to send PETH from operator');

  // deploy requestable contract on childchain
  const tokenAtChild = web3c.eth.contract(abi);
  tokenAtChild.new({ from: operator, gas: 30000000, data: bytecode }, async (err, contract) => {
    if (err) {
      console.log('failed to deploy token contract in child chain');
      process.exit(1);
    }
    if (contract.address) {
      const tx = await rootchainContract.mapRequestableContractByOperator(tokenAtRoot.address, contract.address, { from: operator });
      await wait(3);

      while ((await web3.eth.getTransactionReceipt(tx)) === null) {
        await wait(1);
      }

      if ((await web3.eth.getTransactionReceipt(tx)).status == '0x0') {
        console.error('Failed to map requestable contract. check tx: ', tx);
        process.exit(-1);
      }

      // send PETH between users 'n' times
      await sendPETH(n);
      console.log('done');
    }
  });
}

// deploy requestable token contract, make enter/exit request with sending PETH at the same time
async function test2 (n) {
  // get rootchain address from child chain
  const rootchainAddr = await web3c.eth.rootchain();
  const rootchainContract = await web3.eth.contract(abiRC).at(rootchainAddr);
  console.log(`RootChain address: ${rootchainAddr}`);

  // deploy requestable contract on rootchain
  const tokenAtRoot = await RequestableSimpleToken.new();
  console.log(`RequestSimpleToken address in rootchain: ${tokenAtRoot.address}`);
  for (let i = 0; i < 4; i++) {
    const receipt = await tokenAtRoot.mint(users[i], tokenAmount.mul(100));
    await waitTx('mint RequestSimpleToken, tx hash', receipt.tx);
  }

  const numEROs = await rootchainContract.getNumEROs();
  console.log(`Number of EROs: ${numEROs.toNumber()}`);

  // deploy requestable contract on childchain
  const tokenContractAtChild = web3c.eth.contract(abi);
  tokenContractAtChild.new({ from: operator, gas: 30000000, data: bytecode }, async (err, tokenAtChild) => {
    if (err) {
      console.log('Failed to deploy token contract in 둥child chain');
      process.exit(1);
    }
    if (tokenAtChild.address) {
      console.log(`RequestSimpleToken address in childchain: ${tokenAtChild.address}`);
      const tx = await rootchainContract.mapRequestableContractByOperator(tokenAtRoot.address, tokenAtChild.address, { from: operator });
      while ((await web3.eth.getTransactionReceipt(tx)) === null) {
        await wait(1);
      }
      if ((await web3.eth.getTransactionReceipt(tx)).status == '0x0') {
        console.error('Failed to map requestable contract. check tx: ', tx);
        process.exit(1);
      }
      console.log(`Map requestable contracts, token contract in rootchain: ${tokenAtRoot.address}, token contract in childchain: ${tokenAtChild.address}`);

      await printTokenBalance('Start enter request', tokenAtRoot, tokenAtChild);
      // make enter request in rootchain
      await enter(n, rootchainContract, tokenAtRoot.address);
      
      // NOTE: initial balance at child should be is 0
      let balanceAtChild = tokenAtChild.balances(users[0]);
      if (balanceAtChild != 0) {
        console.log('initial balance at childchain must be 0 before enter')
        process.exit(1);
      }
      while (balanceAtChild == 0) {
        balanceAtChild = tokenAtChild.balances(users[0]);
        await sendEmptyTxToMakeNRB(1);
      }
      numEROS = await rootchainContract.getNumEROs();
      console.log(`Number of EROs: ${numEROS.toNumber()}`);
      await printTokenBalance('Finish enter request', tokenAtRoot, tokenAtChild);

      const costERO = await rootchainContract.COST_ERO();
      console.log(`Cost of ERO: ${costERO}`);

      await printTokenBalance('Start exit request', tokenAtRoot, tokenAtChild);
      await startExit(n, rootchainContract, tokenAtRoot.address, costERO);
      
      await sendEmptyTxToMakeNRB(8);
      numEROS = await rootchainContract.getNumEROs();
      console.log(`Number of EROs: ${numEROS.toNumber()}`);
      await printTokenBalance('Finish exit request', tokenAtRoot, tokenAtChild);

      const target = web3c.eth.blockNumber;
      let lastFinalizedBlock = await rootchainContract.getLastFinalizedBlock(0).toNumber();
      while (lastFinalizedBlock < target) {
        console.log(`Last finalized block number: ${lastFinalizedBlock}, target block number: ${target}`);
        let hash;
        try {
          hash = await rootchainContract.finalizeBlock({ from: users[0] });
        } catch (err) {
          console.error(err);
        }

        let receipt;
        while (!(receipt = await web3.eth.getTransactionReceipt(hash))) {
          await wait(1);
        }
        if (receipt.status === '0x0') {
          console.log('Failed to fianlize block');
        }

        lastFinalizedBlock = await rootchainContract.getLastFinalizedBlock(0).toNumber();
      }
      console.log(`Last finalized block number: ${lastFinalizedBlock}, target block number: ${target}`);

      // wait challenger period
      console.log('Waiting challenger period for 20 seconds');
      await wait(20);

      // apply enter request
      for (let i = 0; i < n; i++) {
        const hash = await rootchainContract.applyRequest({ from: users[0], gas: 2000000 });
        let receipt;
        while (!(receipt = await web3.eth.getTransactionReceipt(hash))) {
          await wait(1);
        }
        if (receipt.status === '0x0') {
          console.log('Failed to apply enter requests');
        } else {
          await printTokenBalance('Succeess to apply enter request', tokenAtRoot, tokenAtChild);
        }
      }
      await printTokenBalance('After apply enter requests', tokenAtRoot, tokenAtChild);

      // apply exit request
      for (let i = 0; i < n; i++) {
        const hash = await rootchainContract.applyRequest({ from: users[0], gas: 2000000 });
        let receipt;
        while (!(receipt = await web3.eth.getTransactionReceipt(hash))) {
          await wait(1);
        }
        if (receipt.status === '0x0') {
          console.log('Failed to apply exit requests');
        } else {
          await printTokenBalance('Succeess to apply exit request', tokenAtRoot, tokenAtChild);
        }
      }
      await printTokenBalance('After apply exit requests', tokenAtRoot, tokenAtChild);
      console.log('Done');
    }
  });
}

async function printTokenBalance (state, tokenAtRoot, tokenAtChild) {
  const balanceAtRoot = await tokenAtRoot.balances(users[0]);
  const balanceAtChild = tokenAtChild.balances(users[0]);
  console.log(`${state}: balance at rootchain ${balanceAtRoot}, balance at childchain ${balanceAtChild}`);
}

async function sendPETHfromOperator (n) {
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < 4; j++) {
      try {
        await web3c.eth.sendTransactionAsync({ from: operator, to: users[j], value: 0 });
      } catch (err) {
        console.log(err);
      }
    }
  }
}

async function sendPETH (n) {
  const promises = [];

  // TODO: make faucet account
  const nonce = await web3c.eth.getTransactionCountAsync(operator);

  for (let i = 0; i < n; i++) {
    try {
      promises.push(web3c.eth.sendTransactionAsync({ nonce: nonce + i, from: operator, to: operator, value: 0 }));
    } catch (err) {
      console.error(err);
    }
  }

  const txs = await Promise.all(promises);
  txs.forEach(tx => {
    console.log(tx);
  });
}

async function sendEmptyTxToMakeNRB (n) {
  for (let i = 0; i < n; i++) {
    try {
      // const nonce = await web3c.eth.getTransactionCountAsync(operator);
      await web3c.eth.sendTransactionAsync({ from: operator, to: operator, value: 0 });
      await wait(5);
      console.log('Make NRB');
    } catch (err) {
      console.error('Failed to send tx to make plsama block', err);
      process.exit(1);
    }
  }
}

async function sendNTransaction (accountIndex, n, plasma) {
  let from;
  let nonce;
  const promises = [];

  if (plasma) {
    from = web3c.eth.accounts[accountIndex];
    nonce = await web3c.eth.getTransactionCountAsync(from);
    for (let i = 0; i < n; i++) {
      promises.push(web3c.eth.sendTransactionAsync({ nonce: nonce + i, from: from, to: from, value: 0 }));
    }
  } else {
    from = web3.eth.accounts[accountIndex];
    nonce = await web3.eth.getTransactionCountAsync(from);
    for (let i = 0; i < n; i++) {
      promises.push(web3.eth.sendTransactionAsync({ nonce: nonce + i, from: from, to: from, value: 0 }));
    }
  }

  let chain;
  if (plasma) {
    chain = 'plasma';
  } else {
    chain = 'ethereum';
  }
  try {
    const txs = await Promise.all(promises);
    txs.forEach(async tx => {
      await waitTx(`send transaction in ${chain}`, tx, plasma);
    });
  } catch (err) {
    console.error(err);
  }
}

// make 'n' startEnter() transaction
async function enter (n, rootchainContract, tokenAddr) {
  const promises = [];
  for (let i = 0; i < n; i++) {
    promises.push(rootchainContract.startEnter(tokenAddr, calcTrieKey(users[0]), padLeft(web3.fromDecimal(tokenAmount)), { from: users[0], gas: 1000000 }));
  }
  try {
    const enterTxs = await Promise.all(promises);
    console.log('Enter transactions:\n', enterTxs);
  } catch (err) {
    console.log(err);
  }
}

async function startExit (n, rootchainContract, tokenAddr, cost) {
  const promises = [];
  for (let i = 0; i < n; i++) {
    promises.push(rootchainContract.startExit(tokenAddr, calcTrieKey(users[0]), padLeft(web3.fromDecimal(tokenAmount.div(100))), { from: users[0], gas: 1000000, value: cost }));
  }
  try {
    const exitTxs = await Promise.all(promises);
    console.log('Exit transactions:\n', exitTxs);
  } catch (err) {
    console.log(err);
  }
}

function deployToken (tokenAtChild, transactionOpt) {
  return new Promise((resolve, reject) => {
    tokenAtChild.new(transactionOpt, function (err, res) {
      if (err) reject(err);
      if (res.address) resolve(res);
    });
  });
}

function wait (sec) {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve();
    }, sec * 1000);
  });
}

async function waitTx (state, hash, plasma) {
  if (plasma) {
    let receipt;
    while (!(receipt = await web3c.eth.getTransactionReceipt(hash))) {
      await wait(1);
    }

    // console.log(`${hash}: ${JSON.stringify(receipt, null, 2)}`);
    console.log(`${state}: ${hash}`);
    if (receipt.status === '0x0') {
      console.error(`${hash} is reverted.`);
    }
  } else {
    let receipt;
    while (!(receipt = await web3.eth.getTransactionReceipt(hash))) {
      await wait(1);
    }

    // console.log(`${hash}: ${JSON.stringify(receipt, null, 2)}`);
    console.log(`${state}: ${hash}`);
    if (receipt.status === '0x0') {
      console.error(`${hash} is reverted.`);
    }
  }
}

function padLeft (str, padLength = DEFAULT_PAD_LENGTH) {
  const v = web3.toHex(str);
  return marshalString(web3.padLeft(unmarshalString(v), padLength));
}

function calcTrieKey (addr) {
  return web3.sha3(appendHex(padLeft(addr), padLeft('0x02')), { encoding: 'hex' });
}

function range (val) {
  return val.split('..').map(Number);
}

module.exports = async function (callback) {
  // truffle exec options
  program
    .option('--network')
    .option('--compile');

  // truffle exec scripts/test-run.js test1 10
  program
    .command('test1 <number of transactions>')
    .description('run test1 using account and number of transactions')
    .option('--child-chain-url [url]', 'A child chain URL')
    .action((n, cmd) => {
      // TODO: process default childchain URL
      if (isNaN(n)) {
        console.error('parameters must be number type');
        process.exit(1);
      }
      test1(n);
    });

  // truffle exec scripts/test-run.js test2 10
  program
    .command('test2 <number of requests>')
    .description('run test2 using account and number of transactions')
    .option('--child-chain-url [url]', 'A child chain URL')
    .action((n, cmd) => {
      if (isNaN(n)) {
        console.error('parameters must be number type');
        process.exit(1);
      }
      test2(n);
    });

  // truffle exec scripts/test-run.js send-eth 0 0..4 50 -p
  program
    .command('send-eth <from-account-index> <first-account-index>..<last-account-index> <amount>')
    .option('-p --plasma')
    .action(async (fromAccountIndex, toAccountIndice, amount, cmd) => {
      const indice = range(toAccountIndice);
      if (isNaN(fromAccountIndex) || isNaN(indice[0]) || isNaN(indice[1]) || isNaN(amount)) {
        console.error('parameters must be number type');
        process.exit(1);
      }
      if (indice[0] > indice[1]) {
        console.error('invalid index order');
        process.exit(1);
      }

      if (fromAccountIndex !== 1) {
        console.warn('from account is not for faucet');
        // 0: operator account
        // 1: faucet account
      }

      if (cmd.plasma) {
        const from = web3c.eth.accounts[fromAccountIndex];
        for (let i = indice[0]; i <= indice[1]; i++) {
          const to = web3c.eth.accounts[i];
          const value = calcAmountToSend(to, new BigNumber(amount), cmd.plasma);
          if (from === to) {
            console.error('from address equals with to address');
            process.exit(1);
          }
          try {
            const hash = await web3c.eth.sendTransactionAsync({ from: from, to: to, value: value });
            await waitTx(`send ${value} wei from ${from} to ${to} in plasma`, hash, cmd.plasma);
            console.log(`from balance: ${web3c.eth.getBalance(from)}, to balance: ${web3c.eth.getBalance(to)}`);
          } catch (err) {
            console.log(err);
            process.exit(1);
          }
        }
      } else {
        const from = web3.eth.accounts[fromAccountIndex];
        for (let i = indice[0]; i <= indice[1]; i++) {
          const to = web3.eth.accounts[i];
          const value = calcAmountToSend(to, new BigNumber(amount));
          if (from === to) {
            console.error('from address equals with to address');
            process.exit(1);
          }
          try {
            const hash = await web3.eth.sendTransactionAsync({ from: from, to: to, value: value });
            await waitTx(`send ${value} wei from ${from} to ${to} in ethereum`, hash);
            console.log(`from balance: ${web3.eth.getBalance(from)}, to balance: ${web3.eth.getBalance(to)}`);
          } catch (err) {
            console.log(err);
            process.exit(1);
          }
        }
      }
    });

  // truffle exec scripts/test-run.js send-tx 1 10 --plasma
  program
    .command('send-tx <account-index> <number of transactions>')
    .option('-p --plasma')
    .action(async (i, n, cmd) => {
      if (isNaN(i) || isNaN(n)) {
        console.error('parameters must be number type');
        process.exit(1);
      }
      try {
        await sendNTransaction(i, n, cmd.plasma);
      } catch (err) {
        console.error(err);
        process.exit(1);
      }
      // process.exit(0);
    });

  // truffle exec scripts/test-run.js apply-request 10
  program
    .command('apply-request <number of requests>')
    .action(async n => {
      if (isNaN(n)) {
        console.error('parameters must be number type');
        process.exit(1);
      }
      const rootchainAddr = await web3c.eth.rootchain();
      const rootchainContract = await web3.eth.contract(abiRC).at(rootchainAddr);
      for (let i = 0; i < n; i++) {
        const hash = await rootchainContract.applyRequest({ from: users[0], gas: 2000000 });
        await waitTx('apply request', hash);
      }
      process.exit(0);
    });

  if (!isWeb3Connected()) {
    console.error('web3 is not connected.');
    process.exit(1);
  }
  program.parse(convertArgv(process.argv));
};

// convertArgv convert process.argv arguments.
// process.argv are different from using node command. because we use truffle exec command.
function convertArgv (argv) {
  const a = [];
  a.push(argv[0]);
  for (let i = 3; i < argv.length; i++) {
    a.push(argv[i]);
  }
  return a;
}

function calcAmountToSend (addr, amount, plasma) {
  if (plasma) {
    const balance = web3c.eth.getBalance(addr);
    if (balance.comparedTo(amount) == 1) return 0;
    return amount.minus(balance);
  } else {
    const balance = web3.eth.getBalance(addr);
    if (balance.comparedTo(amount) == 1) return 0;
    return amount.minus(balance);
  }
}

function isWeb3Connected () {
  if (web3.isConnected() && web3c.isConnected()) {
    return true;
  }
  // TODO: web3Provider
  return false;
}
