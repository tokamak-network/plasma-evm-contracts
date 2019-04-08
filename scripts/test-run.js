const program = require('commander');
const fs = require('fs');
const path = require('path');
const Web3 = require('web3');
const BigNumber = web3.BigNumber;
const Tx = require('ethereumjs-tx');
const ethUtil = require('ethereumjs-util');
const readlineSync = require('readline-sync');

const { appendHex } = require('../test/helpers/appendHex');
const { marshalString, unmarshalString } = require('../test/helpers/marshal');

const RequestableSimpleToken = artifacts.require('RequestableSimpleToken.sol');

const requestSimpleTokenJSON = path.join(__dirname, '..', 'build', 'contracts', 'RequestableSimpleToken.json');
const requestSimpleTokenABI = JSON.parse(fs.readFileSync(requestSimpleTokenJSON).toString()).abi;
const requestSimpleTokenBytecode = JSON.parse(fs.readFileSync(requestSimpleTokenJSON).toString()).bytecode;

const staminaJSON = path.join(__dirname, 'abi', 'Stamina.json');
const staminaABI = JSON.parse(fs.readFileSync(staminaJSON).toString()).abi;

const DEFAULT_PAD_LENGTH = 2 * 32;
const REVERT = '0x0';

const rootchainJSON = path.join(__dirname, '..', 'build', 'contracts', 'RootChain.json');
const rootchainABI = JSON.parse(fs.readFileSync(rootchainJSON).toString()).abi;

let childchainURL;
let web3ForChildChain;
let rootchainContract, staminaContract;
let operator, user;

module.exports = async function (callback) {
  program
    .command('test')
    .option('--child-chain-url [url]', 'A child chain URL', 'http://127.0.0.1:8547')
    .option('--network <network>')
    .action(cmd => {
      childchainURL = cmd.childChainUrl;
      test();
    });

  program
    .command('faucet <accounts...>')
    .option('--child-chain-url [url]', 'A child chain URL', 'http://127.0.0.1:8547')
    .option('-p --plasma')
    .option('-s --sender <address>')
    .option('-v --value <amount>')
    .option('--network <network>')
    .action((accounts, cmd) => {
      childchainURL = cmd.childChainUrl;
      checkAddress(...accounts, cmd.sender);
      checkNumberType(cmd.value);
      faucet(cmd.plasma, cmd.sender, accounts, cmd.value);
    });

  program
    .command('send-tx')
    .option('--child-chain-url [url]', 'A child chain URL', 'http://127.0.0.1:8547')
    .option('-p --plasma')
    .option('--p, --privatekey <private key>')
    .option('-b --bulk <number of transactions')
    .option('-i --interval <seconds>')
    .option('--network <network>')
    .action(cmd => {
      childchainURL = cmd.childChainUrl;
      checkNumberType(cmd.bulk, cmd.interval);
      sendBulkTransaction(cmd.plasma, cmd.privatekey, cmd.bulk, cmd.interval);
    });

  program
    .command('apply-request <number of requests>')
    .option('--child-chain-url [url]', 'A child chain URL', 'http://127.0.0.1:8547')
    .option('--network <network>')
    .action(async (n, cmd) => {
      childchainURL = cmd.childChainUrl;
      checkNumberType(n);
      applyRequest(n);
    });

  program
    .command('set-delegator <address>')
    .option('--child-chain-url [url]', 'A child chain URL', 'http://127.0.0.1:8547')
    .option('--network <network>')
    .action(async (delegator, cmd) => {
      childchainURL = cmd.childChainUrl;
      checkAddress(delegator);
      setDelegator(delegator);
    });

  program.parse(convertArgv(process.argv));
};

function questionAboutYesOrNo (q) {
  while (true) {
    const a = readlineSync.question(`\n${q}`);
    if (a === 'y') break;
    if (a === 'n') process.exit(1);
  }
}

function questionAboutNumber (q) {
  while (true) {
    const a = readlineSync.question(`${q}`);
    if (!isNaN(a)) return a;
  }
}

async function questionAboutAddress (q) {
  while (true) {
    const a = readlineSync.question(`${q}`);
    if (!web3.isAddress(a)) {
      printMessage(`this address(${a}) is not invalid`);
      continue;
    }
    const accountsAtRootChain = await web3.eth.getAccountsAsync();
    if (accountsAtRootChain.includes(a.toLowerCase())) {
      return a.toLowerCase();
    } else {
      printMessage(`this account(${a}) is not availabe`);
    }
  }
}

/* command */
async function test () {
  await init();

  const user = await questionAboutAddress('\nWhat account do you want to use for test?: ');
  let userBalance = await web3.eth.getBalanceAsync(user);
  if (userBalance.toNumber() < 1e18) {
    exitWithMessage('user balance has to have more than 1 eth for test');
  }
  printValue(`balance: ${userBalance.toNumber()}`);

  let requestSimpleTokenAtRootChain, requestSimpleTokenAtChildChain;
  questionAboutYesOrNo('Do you want to deploy RequestSimpleToken contract at RootChain? (y/n): ');
  try {
    requestSimpleTokenAtRootChain = await RequestableSimpleToken.new({ from: operator });
  } catch (err) {
    exitWithMessage(`Failed to deploy RequestSimpleToken at RootChain: ${err}`);
  }
  printValue(`hash: ${requestSimpleTokenAtRootChain.transactionHash}`);
  printValue(`address: ${requestSimpleTokenAtRootChain.address}`);

  questionAboutYesOrNo('Do you want to deploy RequestSimpleToken contract at ChildChain? (y/n): ');
  try {
    const waitBlockSubmit1 = checkSubmittedBlock(1);
    const deployed = await web3ForChildChain.eth.contract(requestSimpleTokenABI).new({ from: operator, gas: 30000000, data: requestSimpleTokenBytecode });
    const contractAddress = await waitTx(web3ForChildChain, deployed.transactionHash);
    await waitBlockSubmit1();
    requestSimpleTokenAtChildChain = await web3ForChildChain.eth.contract(requestSimpleTokenABI).at(contractAddress);
    printValue(`hash: ${deployed.transactionHash}`);
    printValue(`address: ${requestSimpleTokenAtChildChain.address}`);
  } catch (err) {
    exitWithMessage(`Failed to deploy RequestSimpleToekn at ChildChain: ${err}`);
  }

  questionAboutYesOrNo('Do you want to request mapping two deployed contract addresses? (y/n): ');
  try {
    const hash = await rootchainContract.mapRequestableContractByOperatorAsync(requestSimpleTokenAtRootChain.address, requestSimpleTokenAtChildChain.address, { from: operator, gas: 2000000 });
    await waitTx(web3, hash);
    printValue(`hash: ${hash}`);
  } catch (err) {
    exitWithMessage(`Failed to map contracts: ${err}`);
  }

  questionAboutYesOrNo('Do you want to mint token at RootChain? (y/n): ');
  const tokenAmount = questionAboutNumber('How many tokens would you like to mint?: ');
  try {
    const res = await requestSimpleTokenAtRootChain.mint(user, tokenAmount);
    await waitTx(web3, res.tx);
    printValue(`hash: ${res.tx}`);
    printValue(`amount: ${await requestSimpleTokenAtRootChain.balances(user)}`);
  } catch (err) {
    exitWithMessage(`Failed to mint tokens: ${err}`);
  }

  questionAboutYesOrNo('Do you want to enter token at ChildChain? (y/n): ');
  const enterTokenAmount = questionAboutNumber('How many tokens would you like to enter?: ');
  await startEnter(user, 5, requestSimpleTokenAtRootChain.address, enterTokenAmount);

  const NRELength = await rootchainContract.NRELengthAsync();
  questionAboutYesOrNo(`NRE length is ${NRELength}, so you should make ${NRELength * 2 + 1} NRB. Do you want to make ${NRELength * 2 + 1} NRB? (y/n): `);
  await makeNRB(NRELength * 2 + 1);

  questionAboutYesOrNo('You can check whether enter request is applied. Would you check? (y/n): ');
  printValue(`amount(RootChain): ${await requestSimpleTokenAtRootChain.balances(user)}`);
  printValue(`amount(ChildChain): ${await requestSimpleTokenAtChildChain.balances(user)}`);

  questionAboutYesOrNo('Do you want to exit token at ChildChain? (y/n): ');
  const costERO = await rootchainContract.COST_EROAsync();
  userBalance = await web3.eth.getBalanceAsync(user);
  let exitTokenAmount;
  if (new BigNumber(costERO).comparedTo(new BigNumber(userBalance)) === 1) exitWithMessage(`Cost of ERO is ${costERO} and user balance is ${userBalance}, so you can't exit because of short balance.`);
  while (true) {
    exitTokenAmount = questionAboutNumber('How many tokens would you like to exit?: ');
    if (exitTokenAmount <= enterTokenAmount) {
      break;
    }
    printMessage(`It is impossible to exit, because token amount(${exitTokenAmount}) is more than enter token amount(${enterTokenAmount})`);
  }
  await startExit(user, 5, requestSimpleTokenAtRootChain.address, exitTokenAmount, costERO);

  questionAboutYesOrNo(`NRE length is ${NRELength}, so you should make ${NRELength * 2 + 1} NRB. Do you want to make ${NRELength * 2 + 1} NRB? (y/n): `);
  await makeNRB(NRELength * 2 + 1);

  questionAboutYesOrNo('You can check whether exit request is applied. Would you check? (y/n): ');
  printValue(`amount(RootChain): ${await requestSimpleTokenAtRootChain.balances(user)}`);
  printValue(`amount(ChildChain): ${await requestSimpleTokenAtChildChain.balances(user)}`);

  const target = web3ForChildChain.eth.blockNumber;
  let lastFinalizedBlock = await rootchainContract.getLastFinalizedBlockAsync(0);
  questionAboutYesOrNo(`You have to wait until last finalized block number(${lastFinalizedBlock}) and current block number(${target}) is the same. Would you want to finalize? (y/n): `);
  while (true) {
    let hash;
    try {
      hash = await rootchainContract.finalizeBlockAsync({ from: operator, gas: 2000000 });
    } catch (err) {
      exitWithMessage(`Failed to finalize block: ${err}`);
    }
    await waitTx(web3, hash);
    lastFinalizedBlock = await rootchainContract.getLastFinalizedBlockAsync(0);
    printValue(`last finalized block number: ${lastFinalizedBlock}, target block number: ${target}`);
    if (target === lastFinalizedBlock) break;

    questionAboutYesOrNo(`last finalized block number(${lastFinalizedBlock}) and current block number(${target}) are not yet the same. Would you want to finalize? (y/n): `);
  }

  questionAboutYesOrNo('You should wait for 20 seconds(challenger period). Would you wait? (y/n): ');
  await wait(20);

  questionAboutYesOrNo('Do you want to finalize enter request? (y/n): ');
  for (let i = 0; i < 5; i++) {
    let hash;
    try {
      hash = await rootchainContract.finalizeRequestAsync({ from: user, gas: 2000000 });
    } catch (err) {
      exitWithMessage(`Failed to finalize request: ${err}`);
    }
    await waitTx(web3, hash);
  }
  printValue(`amount(RootChain): ${await requestSimpleTokenAtRootChain.balances(user)}`);
  printValue(`amount(ChildChain): ${await requestSimpleTokenAtChildChain.balances(user)}`);

  questionAboutYesOrNo('Do you want to finalize exit request? (y/n): ');
  for (let i = 0; i < 5; i++) {
    let hash;
    try {
      hash = await rootchainContract.finalizeRequestAsync({ from: user, gas: 2000000 });
    } catch (err) {
      exitWithMessage(`Failed to finalize request: ${err}`);
    }
    await waitTx(web3, hash);
  }
  printValue(`amount(RootChain): ${await requestSimpleTokenAtRootChain.balances(user)}`);
  printValue(`amount(ChildChain): ${await requestSimpleTokenAtChildChain.balances(user)}`);

  exitWithMessage('\ntest complete...');
}

async function makeBulkSerializedTx (web3, pk, serializedTxs) {
  await init();

  const privateKey = Buffer.from(pk, 'hex');
  const sender = '0x' + ethUtil.privateToAddress('0x' + pk).toString('hex');
  let nonce;
  try {
    nonce = await web3.eth.getTransactionCountAsync(sender);
  } catch (err) {
    console.log(err);
  }

  for (let i = 0; i < 100000; i++) {
    const rawTx = {
      nonce: '0x' + nonce.toString(16),
      gasPrice: '0x01',
      gasLimit: '0x5208',
      to: '0x0000000000000000000000000000000000000000',
      value: '0x00',
    };
    const tx = new Tx(rawTx);
    tx.sign(privateKey);

    const serializedTx = tx.serialize();
    serializedTxs.push(serializedTx);
    nonce++;
    console.log(nonce);
  }
}

async function sendBulkTransaction (plasma, pk, bulk, interval) {
  await init();

  const _web3 = !plasma ? web3 : web3ForChildChain;
  const serializedTxs = [];
  console.log('making serialized txs...');
  await makeBulkSerializedTx(_web3, pk, serializedTxs);
  console.log(`now you have ${serializedTxs.length} serialized txs`);

  let index = 0;
  while (true) {
    const promises = [];
    for (let j = 0; j < bulk; j++) {
      try {
        if (typeof serializedTxs[index] === 'undefined') {
          exitWithMessage('end of sending bulk txs');
        }
        promises.push(_web3.eth.sendRawTransactionAsync('0x' + serializedTxs[index].toString('hex')));
        index++;
      } catch (err) {
        exitWithMessage(`Failed to send raw transaction: ${err}`);
      }
    }

    try {
      const txs = await Promise.all(promises);
      txs.forEach(async tx => {
        console.log(tx);
      });
    } catch (err) {
      console.log(err);
    }
    await wait(interval);
  }
}

async function faucet (plasma, sender, receivers, amount) {
  await init();

  const _web3 = !plasma ? web3 : web3ForChildChain;
  const accounts = await _web3.eth.getAccountsAsync();
  if (!accounts.includes(sender.toLowerCase())) exitWithMessage('sender address not include in accounts');
  else await isUnlockedAccount(_web3, sender.toLowerCase());

  receivers.forEach(async receiver => {
    if (sender === receiver) exitWithMessage('sender address equals with receiver address');

    const amountToSend = calcAmountToSend(_web3, receiver, new BigNumber(amount));
    if (amountToSend === 0) {
      console.log(`${receiver} already have sufficient amount: ${_web3.eth.getBalance(receiver)}`);
      return true;
    }
    const hash = await _web3.eth.sendTransactionAsync({ from: sender, to: receiver, value: amountToSend });
    await waitTx(_web3, hash);
    console.log(`after faucet, ${receiver} has ${_web3.eth.getBalance(receiver)}`);
  });
}

async function applyRequest (n) {
  await init();

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

async function setDelegator (delegator) {
  await init();

  try {
    const tx = await staminaContract.setDelegatorAsync(delegator, { from: operator, gasPrice: '0x01' });
    await waitTx(web3ForChildChain, tx);
    printMessage(`\nComplete setting delegator(${delegator})`);
  } catch (err) {
    exitWithMessage(`Failed to set delegator: ${err}`);
  }
}

/* helper */
async function init () {
  printMessage('ChildChain status:');
  web3ForChildChain = new Web3(new Web3.providers.HttpProvider(childchainURL));

  // use bluebird
  const Promise = require('bluebird');
  Promise.promisifyAll(web3.eth, { suffix: 'Async' });
  Promise.promisifyAll(web3ForChildChain.eth, { suffix: 'Async' });

  // get rootchain.
  try {
    const rootchainAddr = await web3ForChildChain.eth.rootchain();
    rootchainContract = await web3.eth.contract(rootchainABI).at(rootchainAddr);
    Promise.promisifyAll(rootchainContract, { suffix: 'Async' });
    printValue(`RootChain contract: ${rootchainContract.address}`);
  } catch (err) {
    exitWithMessage(`Failed to get RootChain contract: ${err}`);
  }

  // get operator address from RootChain contract.
  try {
    operator = await rootchainContract.operatorAsync();
    printValue(`operator: ${operator}`);
  } catch (err) {
    exitWithMessage(`Failed to get operator account: ${err}`);
  }

  // get operator's balance
  let operatorBalance, stamina;
  try {
    operatorBalance = await web3.eth.getBalanceAsync(operator);
    printValue(`balance: ${operatorBalance.toNumber()}`);
  } catch (err) {
    exitWithMessage(`Failed to get operator's balance: ${err}`);
  }

  // get operator's stamina.
  try {
    staminaContract = web3ForChildChain.eth.contract(staminaABI).at('0x000000000000000000000000000000000000dead');
    Promise.promisifyAll(staminaContract, { suffix: 'Async' });
  } catch (err) {
    exitWithMessage(`Failed to wrap stmaina contract: ${err}`);
  }
  try {
    stamina = await staminaContract.getStaminaAsync(operator);
    printValue(`stamina: ${stamina.toNumber()}`);
  } catch (err) {
    exitWithMessage(`Failed to get operator's stamina: ${err}`);
  }

  if (operatorBalance.toNumber() < 1e18 && stamina.toNumber() < 1e18) {
    exitWithMessage('operator has to have more than 1 eth or 1e18 stamina for test');
  }
}

async function makeNRB (number) {
  for (let i = 0; i < number; i++) {
    try {
      const waitBlockSubmit1 = checkSubmittedBlock(1);
      await web3ForChildChain.eth.sendTransactionAsync({ from: operator, to: operator, value: 0 });
      await waitBlockSubmit1();
      printValue('NRB is created...');
    } catch (err) {
      exitWithMessage(`Failed to send empty transaction: ${err}`);
    }
  }
}

async function startEnter (user, n, tokenAddr, tokenAmount) {
  const promises = [];
  for (let i = 0; i < n; i++) {
    promises.push(rootchainContract.startEnterAsync(tokenAddr, calcTrieKey(user), padLeft(web3.fromDecimal(tokenAmount)), { from: user, gas: 2000000 }));
  }
  try {
    const enterTxs = await Promise.all(promises);
    for (const tx of enterTxs) {
      await waitTx(web3, tx);
      printValue(`hash: ${tx}`);
    }
  } catch (err) {
    exitWithMessage(`Failed to enter: ${err}`);
  }
}

async function startExit (user, n, tokenAddr, tokenAmount, cost) {
  const promises = [];
  for (let i = 0; i < n; i++) {
    promises.push(rootchainContract.startExitAsync(tokenAddr, calcTrieKey(user), padLeft(web3.fromDecimal(tokenAmount)), { from: user, gas: 2000000, value: cost }));
  }
  try {
    const exitTxs = await Promise.all(promises);
    for (const tx of exitTxs) {
      await waitTx(web3, tx);
      printValue(`hash: ${tx}`);
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
  if (balance.comparedTo(amount) === 1) return 0;
  return amount.minus(balance);
}

async function isUnlockedAccount (web3, account) {
  try {
    // NOTE:
    // web3.eth.sign(address, dataToSign [, callback]) // web3.js 0.x.x
    // web3.eth.sign(dataToSign, address [, callback]) // web3.js 1.0
    // not work in HDWalletProvider
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
      await wait(2);
    }
  };
  return f;
}

async function isNRBSubmitted (cur) {
  const next = await rootchainContract.lastBlockAsync(0);
  return (cur.toNumber() + 1 === next.toNumber());
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

function printValue (log) {
  console.log(`  ${log}`);
}

function printMessage (log) {
  console.log(`${log}`);
}
