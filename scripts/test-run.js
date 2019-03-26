const program = require('commander');
const fs = require('fs');
const path = require('path');
const Web3 = require('web3');
const BigNumber = web3.BigNumber;
const Tx = require('ethereumjs-tx')

const { appendHex } = require('../test/helpers/appendHex');
const { marshalString, unmarshalString } = require('../test/helpers/marshal');

const RequestableSimpleToken = artifacts.require('RequestableSimpleToken.sol');

const requestSimpleTokenJSON = path.join(__dirname, '..', 'build', 'contracts', 'RequestableSimpleToken.json');
const requestSimpleTokenABI = JSON.parse(fs.readFileSync(requestSimpleTokenJSON).toString()).abi;
const requestSimpleTokenBytecode = JSON.parse(fs.readFileSync(requestSimpleTokenJSON).toString()).bytecode;

const DEFAULT_PAD_LENGTH = 2 * 32;
const REVERT = '0x0';

const rootchainJSON = path.join(__dirname, '..', 'build', 'contracts', 'RootChain.json');
const rootchainABI = JSON.parse(fs.readFileSync(rootchainJSON).toString()).abi;
const defaultChildChainURL = 'http://127.0.0.1:8547';

let web3ForChildChain;
let rootchainContract;
let operator, user;
let accountsAtRootChain, accountsAtChildChain;

module.exports = async function (callback) {
  // truffle exec options
  program
    .option('--network')
    .option('--compile');

  program
    .command('test')
    .description('for plasma-evm test')
    .option('--child-chain-url [url]', 'A child chain URL')
    .option('-r --request <number of requests>', 'make enter/exit requests')
    .option('-b --bulk <number of transactions>', 'send bulk transactions')
    .action(cmd => {
      if (cmd.request) checkNumberType(cmd.request);
      if (cmd.bulk) checkNumberType(cmd.bulk);
      test(cmd.request, cmd.bulk);
    });

  program
    .command('faucet <accounts...>')
    .option('-p --plasma')
    .option('-s --sender <address>')
    .option('-v --value <amount>')
    .action((accounts, cmd) => {
      checkAddress(...accounts, cmd.sender);
      checkNumberType(cmd.value);
      faucet(cmd.plasma, cmd.sender, accounts, cmd.value);
    });

  program
    .command('send-tx')
    .option('-p --plasma')
    .option('-b --bulk <number of transactions')
    .option('-i --interval <seconds>')
    .action(cmd => {
      checkNumberType(cmd.bulk, cmd.interval);
      sendBulkTransaction(cmd.plasma, cmd.bulk, cmd.interval);
    });

  // truffle exec scripts/test-run.js apply-request 10
  program
    .command('apply-request <number of requests>')
    .action(async n => {
      checkNumberType(n);
      applyRequest(n);
    });

  program.parse(convertArgv(process.argv));
};

/* command */
async function test (n, bulk) {
  await init(defaultChildChainURL);

  const etherAmount = new BigNumber(10e30);
  const faucet = await web3ForChildChain.eth.sendTransactionAsync({ from: operator, to: user, value: etherAmount });
  await waitTx(web3ForChildChain, faucet);
  console.log(`faucet is complete
  operator balance: ${await web3ForChildChain.eth.getBalanceAsync(operator)}
  user balance: ${await web3ForChildChain.eth.getBalanceAsync(user)}\n`);
  
  let requestSimpleTokenAtRootChain, requestSimpleTokenAtChildChain;
  try {
    requestSimpleTokenAtRootChain = await RequestableSimpleToken.new({ from: operator });
    console.log(`RequestSimpleToken contract(rootchain): ${requestSimpleTokenAtRootChain.address}`);
  } catch (err) {
    exitWithMessage(`Failed to deploy RequestSimpleToken: ${err}`);
  }

  try {
    const deployed = await web3ForChildChain.eth.contract(requestSimpleTokenABI).new({ from: operator, gas: 30000000, data: requestSimpleTokenBytecode });
    const contractAddress = await waitTx(web3ForChildChain, deployed.transactionHash);
    requestSimpleTokenAtChildChain = await web3ForChildChain.eth.contract(requestSimpleTokenABI).at(contractAddress);
    console.log(`RequestSimpleToken contract(childchain): ${requestSimpleTokenAtChildChain.address}\n`);
  } catch (err) {
    exitWithMessage(`Failed to deploy RequestSimpleToekn at childchain: ${err}`);
  }

  console.log('map SimpleRequestToken contracts');
  try {
    const hash = await rootchainContract.mapRequestableContractByOperatorAsync(requestSimpleTokenAtRootChain.address, requestSimpleTokenAtChildChain.address, { from: operator, gas: 2000000 });
    await waitTx(web3, hash);
  } catch (err) {
    exitWithMessage(`Failed to map contracts: ${err}`);
  }
  
  console.log('mint token');
  const tokenAmount = new BigNumber(10e18);
  try {
    const res = await requestSimpleTokenAtRootChain.mint(user, tokenAmount.mul(100));
    await waitTx(web3, res.tx);
  } catch (err) {
    exitWithMessage(`Failed to mint tokens: ${err}`);
  }

  try {
    const numEROs = await rootchainContract.getNumEROsAsync();
    console.log(`\nnumber of EROs: ${numEROs.toNumber()}`);
  } catch (err) {
    exitWithMessage(`Failed to get number of EROs: ${err}`);
  }

  const NRELength = await rootchainContract.NRELengthAsync();
  await printTokenBalance('Start enter request', requestSimpleTokenAtRootChain, requestSimpleTokenAtChildChain);
  await startEnter(user, n, requestSimpleTokenAtRootChain.address, tokenAmount);
  await makeNRB(NRELength * 2 + 1, bulk); // (* 2 for delayed reuqest, + 1 for ORB to be mining)

  try {
    const numEROs = await rootchainContract.getNumEROsAsync();
    console.log(`\nnumber of EROs: ${numEROs.toNumber()}`);
  } catch (err) {
    exitWithMessage(`Failed to get number of EROs: ${err}`);
  }
  await printTokenBalance('Finish enter request', requestSimpleTokenAtRootChain, requestSimpleTokenAtChildChain);

  const costERO = await rootchainContract.COST_EROAsync();
  console.log(`\nCost of ERO: ${costERO}`);
  await printTokenBalance('Start exit request', requestSimpleTokenAtRootChain, requestSimpleTokenAtChildChain);
  await startExit(user, n, requestSimpleTokenAtRootChain.address, tokenAmount, costERO);
  await makeNRB(NRELength * 2 + 1, bulk);

  try {
    const numEROs = await rootchainContract.getNumEROsAsync();
    console.log(`\nnumber of EROs: ${numEROs.toNumber()}`);
  } catch (err) {
    console.error(err);
  }
  await printTokenBalance('Finish exit request', requestSimpleTokenAtRootChain, requestSimpleTokenAtChildChain);

  const target = web3ForChildChain.eth.blockNumber;
  let lastFinalizedBlock = await rootchainContract.getLastFinalizedBlockAsync(0);
  console.log('\n');
  while (lastFinalizedBlock.toNumber() < target) {
    console.log(`Last finalized block number: ${lastFinalizedBlock}, target block number: ${target}`);
    let hash;
    try {
      hash = await rootchainContract.finalizeBlockAsync({ from: user });
    } catch (err) {
      exitWithMessage(`Failed to finalize block: ${err}`);
    }
    await waitTx(web3, hash);
    lastFinalizedBlock = await rootchainContract.getLastFinalizedBlockAsync(0);
  }
  console.log(`Last finalized block number: ${lastFinalizedBlock}, target block number: ${target}`);

  // wait challenger period
  console.log('\nWaiting challenger period for 20 seconds');
  await wait(20);
  
  // apply enter request
  for (let i = 0; i < n; i++) {
    let hash;
    try {
      hash = await rootchainContract.finalizeRequestAsync({ from: user, gas: 2000000 });
    } catch (err) {
      exitWithMessage(`Failed to finalize request: ${err}`);
    }
    if (await waitTx(web3, hash)) {
      await printTokenBalance('Succeess to apply enter request', requestSimpleTokenAtRootChain, requestSimpleTokenAtChildChain);
    }
  }
  await printTokenBalance('After apply enter requests', requestSimpleTokenAtRootChain, requestSimpleTokenAtChildChain, tokenAmount);
  console.log('\n');

  // apply exit request
  for (let i = 0; i < n; i++) {
    let hash;
    try {
      hash = await rootchainContract.finalizeRequestAsync({ from: user, gas: 2000000 });
    } catch (err) {
      exitWithMessage(`Failed to finalize request: ${err}`);
    }
    if (await waitTx(web3, hash)) {
      await printTokenBalance('Succeess to apply exit request', requestSimpleTokenAtRootChain, requestSimpleTokenAtChildChain);
    }
  }
  await printTokenBalance('After apply exit requests', requestSimpleTokenAtRootChain, requestSimpleTokenAtChildChain);

  process.exit(0);
}

async function makeBulkSerializedTx (web3, serializedTxs) {
  // TODO: how to get pk / address
  let privateKey = new Buffer('b71c71a67e1177ad4e901695e1b4b9ee17ae16c6668d313eac2f96dbcda3f291', 'hex')
  let nonce;
  try {
    nonce = await web3.eth.getTransactionCountAsync('0x71562b71999873DB5b286dF957af199Ec94617F7');
  } catch (err) {
    console.log(err);
  }
  while (true) {
    let rawTx = {
      nonce: nonce.toString(16),
      gasPrice: '0x01', 
      gasLimit: '0x5208',
      to: '0x0000000000000000000000000000000000000000', 
      value: '0x00', 
    }
    let tx = new Tx(rawTx);
    tx.sign(privateKey);
    
    let serializedTx = tx.serialize();
    serializedTxs.push(serializedTx);
    nonce++;
    console.log(nonce);
    await wait(4);
      
    try {
      await web3.eth.sendRawTransactionAsync('0x' + serializedTx.toString('hex'));
    } catch (err) {
      console.log(err);
    }
  }
}


async function sendBulkTransaction (plasma, bulk, interval) {
  await init(defaultChildChainURL);
  
  const _web3 = !plasma ? web3 : web3ForChildChain;
  const serializedTxs = [];  
  makeBulkSerializedTx(_web3, serializedTxs)
  
  const accounts = await _web3.eth.getAccountsAsync();
  if (accounts.length === 0) {
    exitWithMessage(`No account to use.`)
  }
  const sender = accounts[0];
  console.log(`sender address: ${sender}\n`);
  await isUnlockedAccount(_web3, sender.toLowerCase());
  
  let nonce = await _web3.eth.getTransactionCountAsync(sender);
  while (true) {
    const promises = [];
    for (let i = 0; i < bulk; i++) {
      try {
        promises.push(_web3.eth.sendTransactionAsync({ nonce: nonce, from: sender, to: sender, value: 0 }));
      } catch (err) {
        console.error(err);
      }
      nonce++;
    }

    const txs = await Promise.all(promises);
    txs.forEach(async tx => {
      try {
        console.log(await waitTx(_web3, tx));
      } catch (err) {
        console.error(err);
      }
    });
    await wait(interval);
  }
}

async function faucet (plasma, sender, receivers, amount) {
  await init(defaultChildChainURL);

  const _web3 = !plasma ? web3 : web3ForChildChain;
  const accounts = await _web3.eth.getAccountsAsync();
  if (!accounts.includes(sender.toLowerCase())) exitWithMessage('sender address not include in accounts');
  else await isUnlockedAccount(_web3, sender.toLowerCase());

  receivers.forEach(async receiver => {
    if (sender === receiver) exitWithMessage('sender address equals with receiver address');

    const amountToSend = calcAmountToSend(_web3, receiver, new BigNumber(amount));
    if (amountToSend == 0) {
      console.log(`${receiver} already have sufficient amount: ${_web3.eth.getBalance(receiver)}`);
      return true;
    }
    const hash = await _web3.eth.sendTransactionAsync({ from: sender, to: receiver, value: amountToSend });
    await waitTx(_web3, hash);
    console.log(`after faucet, ${receiver} has ${_web3.eth.getBalance(receiver)}`);
  });
}

async function applyRequest (n) {
  await init(defaultChildChainURL);

  for (let i = 0; i < n; i++) {
    let hash;
    try {
      hash = await rootchainContract.finalizeRequestAsync({ from: user, gas: 2000000 });
    } catch (err) {
      exitWithMessage(`Failed to finalize request: ${err}`);
    }
    await waitTx(web3, hash);
  }
}

/* helper */
async function init (childChainURL) {
  // web3 is connected at rootchain and web3ForChildChain is connected at childchain.
  web3ForChildChain = new Web3(new Web3.providers.HttpProvider(childChainURL));

  // use bluebird
  const Promise = require('bluebird');
  Promise.promisifyAll(web3.eth, { suffix: 'Async' });
  Promise.promisifyAll(web3ForChildChain.eth, { suffix: 'Async' });
  // Promise.promisifyAll(web3Provider.eth, { suffix: 'Async' });

  // number of accounts must be greater than 2.
  try {
    accountsAtRootChain = await web3.eth.getAccountsAsync();
    accountsAtChildChain = await web3ForChildChain.eth.getAccountsAsync();
    if (accountsAtRootChain.length < 2) {
      console.error('There are not enough accounts to test in rootchain.');
    }
    // TODO: classify operator / user
    operator = accountsAtRootChain[0];
    user = accountsAtRootChain[1];
  } catch (err) {
    console.error(`Failed to get accounts: ${err}`);
  }

  // get rootchain.
  try {
    const rootchainAddr = await web3ForChildChain.eth.rootchain();
    rootchainContract = await web3.eth.contract(rootchainABI).at(rootchainAddr);
    Promise.promisifyAll(rootchainContract, { suffix: 'Async' });
  } catch (err) {
    console.error(`Failed to get rootchain contract: ${err}`);
  }

//   console.log(`
// RootChain: ${rootchainContract.address}
// operator: ${operator}
// user: ${user}
//   `
//   );
}

// NRB: number of NRBs
// bulk: number of bulk transactions
async function makeNRB (NRB, bulk) {
  let nonce = await web3ForChildChain.eth.getTransactionCountAsync(operator);
  for (let i = 0; i < NRB; i++) {
    if (bulk) {
      let NRBSubmitted = false;
      const lastBlock = await rootchainContract.lastBlockAsync(0);
      while (!NRBSubmitted) {
        const promises = [];
        for (let j = 0; j < bulk; j++) {
          promises.push(web3ForChildChain.eth.sendTransactionAsync({ nonce: nonce, from: operator, to: operator, value: 0 }));
          nonce++;
        }
        await Promise.all(promises);
        console.log('bulk empty transaction to make NRB...');
        if (await isNRBSubmitted(lastBlock)) {
          NRBSubmitted = true;
          console.log('NRB is submitted...\n');
        }
        await wait(5);
      }
    } else {
      try {
        const waitBlockSubmit1 = checkSubmittedBlock(1);
        await web3ForChildChain.eth.sendTransactionAsync({ from: operator, to: operator, value: 0 });
        console.log('\nsend empty transaction...');
        await waitBlockSubmit1();
      } catch (err) {
        exitWithMessage(`Failed to send empty transaction: ${err}`);
      }
    }
  }
}

// make 'n' startEnter() transaction
async function startEnter (user, n, tokenAddr, tokenAmount) {
  const promises = [];
  for (let i = 0; i < n; i++) {
    promises.push(rootchainContract.startEnterAsync(tokenAddr, calcTrieKey(user), padLeft(web3.fromDecimal(tokenAmount)), { from: user, gas: 2000000 }));
  }
  try {
    const enterTxs = await Promise.all(promises);
    console.log('Enter transactions:\n', enterTxs);

    for (const tx of enterTxs) {
      await waitTx(web3, tx);
    }
  } catch (err) {
    exitWithMessage(`Failed to enter: ${err}`);
  }
}

async function startExit (user, n, tokenAddr, tokenAmount, cost) {
  const promises = [];
  for (let i = 0; i < n; i++) {
    promises.push(rootchainContract.startExitAsync(tokenAddr, calcTrieKey(user), padLeft(web3.fromDecimal(tokenAmount)), { from: user, gas: 1000000, value: cost }));
  }
  try {
    const exitTxs = await Promise.all(promises);
    console.log('Exit transactions:\n', exitTxs);

    for (const tx of exitTxs) {
      await waitTx(web3, tx);
    }
  } catch (err) {
    exitWithMessage(`Failed to exit: ${err}`);
  }
}

function wait (sec) {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve();
    }, sec * 1000);
  });
}

// TODO: fix plasma option
async function waitTx (web3, hash) {
  let receipt;
  while (true) {
    receipt = await web3.eth.getTransactionReceiptAsync(hash);
    if (receipt) break;
    await wait(1);
  }

  if (receipt.status === REVERT) {
    console.error(`transaction(${hash}) is reverted`);
    return false;
  }
  if (receipt.contractAddress) {
    return receipt.contractAddress;
  } else {
    return receipt.transactionHash;
  }
}

function calcAmountToSend (web3, receiver, amount) {
  const balance = web3.eth.getBalance(receiver);
  if (balance.comparedTo(amount) == 1) return 0;
  return amount.minus(balance);
}

async function isUnlockedAccount (web3, account) {
  try {
    // NOTE:
    // web3.eth.sign(address, dataToSign [, callback]) // web3.js 0.x.x
    // web3.eth.sign(dataToSign, address [, callback]) // web3.js 1.0
    await web3.eth.signAsync(account, '');
  } catch (err) {
    exitWithMessage('locked account');
  }
  return true;
}

function checkSubmittedBlock (n) {
  const p = rootchainContract.lastBlockAsync(0);
  const f = async () => {
    const cur = (await p).toNumber();
    let next = (await rootchainContract.lastBlockAsync(0)).toNumber();

    while (cur + n > next) {
      next = (await rootchainContract.lastBlockAsync(0)).toNumber();
      console.log('wait block submission...');
      await wait(2);
    }
  };
  return f;
}

async function isNRBSubmitted (cur) {
  const next = await rootchainContract.lastBlockAsync(0);
  return (cur.toNumber() + 1 == next.toNumber());
}

/* util */
function exitWithMessage (message) {
  console.error(message);
  process.exit(0);
}

function padLeft (str, padLength = DEFAULT_PAD_LENGTH) {
  const v = web3.toHex(str);
  return marshalString(web3.padLeft(unmarshalString(v), padLength));
}

function calcTrieKey (addr) {
  return web3.sha3(appendHex(padLeft(addr), padLeft('0x02')), { encoding: 'hex' });
}

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

function checkNumberType (...params) {
  for (let i = 0; i < params.length; i++) {
    if (isNaN(params[i])) exitWithMessage(`not number type: ${params[i]}`);
  }
}

function checkAddress (...accounts) {
  accounts.forEach(account => {
    if (!web3.isAddress(account)) exitWithMessage(`invalid address: ${account}`);
  });
  return true;
}

async function printTokenBalance (state, tokenAtRoot, tokenAtChild) {
  try {
    const balanceAtRoot = await tokenAtRoot.balances(user);
    const balanceAtChild = tokenAtChild.balances(user);
    console.log(`${state}
  token balance at rootchain: ${balanceAtRoot}
  token balance at childchain: ${balanceAtChild}`);
  } catch (err) {
    exitWithMessage(`Filed to get balance: ${err}`);
  }
}
