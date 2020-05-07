// truffle exec

const fs = require('fs');
const path = require('path');

const ERC20 = artifacts.require('ERC20');

const outputPath = path.join(__dirname, '../', 'outputs.json');

const TARGET_BLOCK_NUMBER = process.env.TARGET_BLOCK_NUMBER === '0' ? 'latest' : process.env.TARGET_BLOCK_NUMBER;

const balanceIndex = 1;

function getTokenInstance () {
  switch (process.env.TARGET_TOKEN) {
  case 'SeedTON':
    return ERC20.at(process.env.SeedTON);
  case 'PrivateTON':
    return ERC20.at(process.env.PrivateTON);
  case 'MTON':
    return ERC20.at(process.env.MTON_FARADAY);
  default:
    throw new Error('Unknown target token. Use one of SeedTON, PrivateTON, MTON');
  }
}

function wait (sec) {
  return new Promise(resolve => setTimeout(resolve, sec * 1000));
}

function checkProgress (senders, outputs) {
  return new Promise(async (resolve) => {
    while (senders.length !== outputs.length) {
      await wait(0.2);
      console.log(`Fetch balances [${outputs.length}/${senders.length}]`);
    }

    resolve();
  });
}

function balancePosition (address) {
  const index = web3.utils.padLeft(balanceIndex, 64).slice(2);
  const key = web3.utils.padLeft(address, 64).slice(2);

  return web3.utils.sha3('0x' + key + index);
}

function fetchBalances (token, senders, outputs) {
  return Promise.all(
    senders.map(
      async (sender) => {
        const position = balancePosition(sender);
        const balance = await web3.eth.getStorageAt(token.address, position);

        outputs.push({ sender, balance });
      },
    ),
  );
}

function checkOutputs (senders, outputs) {
  const allFetchedSenders = outputs.map(({ sender }) => sender);
  const filtered = Array.from(new Set(allFetchedSenders));
  if (senders.length !== filtered.length) {
    throw new Error(`fetched result length mismatch: (sender=${senders.length}, fetched=${filtered.length})`);
  }
}

function filterOutput (outputs) {
  return outputs.filter(o => web3.utils.toBN(o.balance).cmp(web3.utils.toBN(0)) > 0);
}

async function main () {
  const token = await getTokenInstance();

  console.log('TARGET_BLOCK_NUMBER', TARGET_BLOCK_NUMBER);

  const events = await token.getPastEvents('Transfer', {
    fromBlock: 0,
    toBlock: TARGET_BLOCK_NUMBER,
  });

  const allSenders = events.map(({ args }) => args.to);
  const senders = Array.from(new Set(allSenders));

  console.log('total holders:', senders.length);

  const outputs = [];

  const fProm = fetchBalances(token, senders, outputs);
  const pProm = checkProgress(senders, outputs);

  await fProm;
  await pProm;

  await wait(1);
  checkOutputs(senders, outputs);

  const nonZero = filterOutput(outputs);

  console.log('non-zero token holders:', nonZero.length);

  fs.writeFileSync(outputPath, JSON.stringify(nonZero, null, 2));
  console.log('output file exported:', outputPath);
}

module.exports = (done) => main().then(done).catch(done);
