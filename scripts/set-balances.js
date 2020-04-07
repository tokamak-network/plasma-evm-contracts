// truffle exec

const fs = require('fs');
const path = require('path');

const { createCurrency } = require('@makerdao/currency');

const MTON = artifacts.require('MTON');
const MTONMigrator = artifacts.require('MTONMigrator');

const _MTON = createCurrency('MTON');

const outputPath = path.join(__dirname, '../', 'outputs.json');

const n = 50;

const tokenAddress = process.env.MTON_MAINNET;
const migratorAddress = process.env.MTON_MIGRATOR;

console.log('tokenAddress', tokenAddress);
console.log('migratorAddress', migratorAddress);

const { toBN } = web3.utils;
const z = toBN('0');

function bnToMTONString (v) {
  return _MTON.wei(toBN(v)).toString();
}

function wait (sec) {
  return new Promise(resolve => setTimeout(resolve, sec * 1000));
}

async function checkProgress (from, startNonce, targetNonce) {
  let nonce = await web3.eth.getTransactionCount(from);

  return new Promise(async (resolve) => {
    while (nonce < targetNonce) {
      await wait(0.2);
      console.log(`Waiting mining (mined=${nonce - startNonce}, pending=${targetNonce - nonce})`);
      nonce = await web3.eth.getTransactionCount(from);
    }

    resolve();
  });
}

function checkBalances (outputs, migratorBalances) {
  outputs.forEach(({ sender }, i) => {
    const balance = migratorBalances[i];
    if (balance.cmp(z) > 0) {
      // TODO: activate below
      console.error(`${sender} already set balance ${bnToMTONString(balance)}`);
    }
  });
}

function filterOutputs (outputs, balances) {
  return outputs.filter((_, i) => {
    const balance = balances[i];
    return balance.cmp(z) === 0;
  });
}

function setBalances (migrator, outputs) {
  let bulk = outputs.splice(0, n);
  const proms = [];

  console.log();

  let i = 0;
  while (bulk.length > 0) {
    const senders = bulk.map(({ sender }) => sender);
    const balances = bulk.map(({ balance }) => balance);

    // proms.push(migrator.resetBalanceMulti(senders));
    proms.push(migrator.setBalanceMulti(senders, balances));

    console.log(`send ${i}-th transaction: ${senders.length} accounts`);
    i++;

    bulk = outputs.splice(0, n);
  }

  return Promise.all(proms);
}

function checkOutputs (migrator, outputs) {
  return Promise.all(outputs.map(async ({ sender, balance }) => {
    const balance2 = toBN(await migrator.balances(sender));

    if (toBN(balance).cmp(balance2) !== 0) {
      console.error(`${sender} has different balance ${bnToMTONString(balance2)}, expected ${bnToMTONString(balance)}`);
    }
  }));
}

async function main () {
  const from = (await web3.eth.getAccounts())[0];
  console.log('from', from);

  const token = await MTON.at(tokenAddress);
  const migrator = await MTONMigrator.at(migratorAddress);

  const outputStr = fs.readFileSync(outputPath);
  const outputs = JSON.parse(outputStr);

  const totalBalance = outputs
    .map(({ balance }) => toBN(balance))
    .reduce((a, b) => a.add(b));

  const migratorMTONBalance = await token.balanceOf(migrator.address);
  const migratorBalances = await Promise.all(outputs.map(({ sender }) => migrator.balances(sender)));

  console.log('total holders:', outputs.length);
  console.log('total totalBalance:', bnToMTONString(totalBalance));
  console.log('migrator balance:', bnToMTONString(migratorMTONBalance));

  if (migratorMTONBalance.cmp(totalBalance) < 0) {
    const diff = totalBalance.sub(migratorMTONBalance);

    console.warn(`migrator has not enough MTON to migrate. Mint ${bnToMTONString(diff)}`);

    // await token.mint(migrator.address, diff);
  }

  console.log();
  console.log('check balances...');
  checkBalances(outputs, migratorBalances);

  const filteredOutputs = filterOutputs(outputs, migratorBalances);

  console.log('filtered holders (zero-balance accounts):', filteredOutputs.length);

  if (filteredOutputs.length === 0) {
    console.log('all account balances are set');
    return;
  }

  const startNonce = await web3.eth.getTransactionCount(from);
  const targetNonce = startNonce + Math.ceil(filteredOutputs.length / n);

  const cProm = checkProgress(from, startNonce, targetNonce);

  // const proms = setBalances(migrator, filteredOutputs);
  // await proms;
  await cProm;

  console.log();
  console.log('check outputs...');
  await checkOutputs(migrator, outputs);
}

module.exports = (done) => main().then(done).catch(done);
