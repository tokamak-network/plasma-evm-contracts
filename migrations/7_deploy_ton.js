const TON = artifacts.require('TON.sol');

const { BN, toWei } = require('web3-utils');
const ether = n => new BN(toWei(n, 'ether'));

// account
const swapper   = '0x0000000000000000000000000000000000000001'; // eslint-disable-line no-multi-spaces
const pub       = '0x0000000000000000000000000000000000000002'; // eslint-disable-line no-multi-spaces
const team      = '0x0000000000000000000000000000000000000003'; // eslint-disable-line no-multi-spaces
const advisor   = '0x0000000000000000000000000000000000000004'; // eslint-disable-line no-multi-spaces
const marketing = '0x0000000000000000000000000000000000000005';
const business  = '0x0000000000000000000000000000000000000006'; // eslint-disable-line no-multi-spaces
const reserve   = '0x0000000000000000000000000000000000000007'; // eslint-disable-line no-multi-spaces
const dao       = '0x0000000000000000000000000000000000000008'; // eslint-disable-line no-multi-spaces

// amount
const seedAmount      = ether('1500000');  // eslint-disable-line no-multi-spaces
const privAmount      = ether('7200000');  // eslint-disable-line no-multi-spaces
const strategicAmount = ether('4200000');
const swapperAmount = seedAmount.add(privAmount).add(strategicAmount);

const pubAmount       = ether('100000');   // eslint-disable-line no-multi-spaces
const teamAmount      = ether('7500000');  // eslint-disable-line no-multi-spaces
const advisorAmount   = ether('1500000');  // eslint-disable-line no-multi-spaces

const marketingAmount = ether('2500000');

const businessAmount  = ether('5000000');  // eslint-disable-line no-multi-spaces
const reserveAmount   = ether('3000000');   // eslint-disable-line no-multi-spaces
const daoAmount       = ether('17500000'); // eslint-disable-line no-multi-spaces

const totalSupply = swapperAmount
  .add(pubAmount)
  .add(teamAmount)
  .add(advisorAmount)
  .add(marketingAmount)
  .add(businessAmount)
  .add(reserveAmount)
  .add(daoAmount);

module.exports = function (deployer, network) {
  if (network.includes('mainnet') || network.includes('rinkeby') || network.includes('development')) return;
  if (!totalSupply.eq(ether('50000000'))) return;

  deployer.deploy(TON)
    .then(async token => {
      await token.mint(swapper, swapperAmount);
      await token.mint(pub, pubAmount);
      await token.mint(team, teamAmount);
      await token.mint(advisor, advisorAmount);
      await token.mint(marketing, marketingAmount);
      await token.mint(business, businessAmount);
      await token.mint(reserve, reserveAmount);
      await token.mint(dao, daoAmount);
    })
    .catch(e => { throw e; });
};
