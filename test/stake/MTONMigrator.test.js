const flatten = require('lodash/flatten');
const range = require('lodash/range');

const { createCurrency, createCurrencyRatio } = require('@makerdao/currency');
const {
  defaultSender, accounts, contract, web3,
} = require('@openzeppelin/test-environment');
const {
  BN, constants, expectEvent, expectRevert, time, ether,
} = require('@openzeppelin/test-helpers');

const MTON = contract.fromArtifact('MTON');
const MTONMigrator = contract.fromArtifact('MTONMigrator');

const chai = require('chai');
const { expect } = chai;
chai.use(require('chai-bn')(BN))
  .should();

const _MTON = createCurrency('MTON');

const MTON_UNIT = 'wei';

const tokenAmount = _MTON('100', MTON_UNIT);

describe('stake/MTONMigrator', function () {
  beforeEach(async function () {
    this.mton = await MTON.new();
    this.migrator = await MTONMigrator.new(this.mton.address);

    await this.mton.mint(this.migrator.address, tokenAmount.times(accounts.length).toFixed(MTON_UNIT));
  });

  describe('#setBalance', function () {
    it('owner can set claimable token amount', async function () {
      await Promise.all(accounts.map(account => this.migrator.setBalance(account, tokenAmount.toFixed(MTON_UNIT))));

      const claimables = await Promise.all(accounts.map(account => this.migrator.claimable(account)));
      const balances = await Promise.all(accounts.map(account => this.migrator.balances(account)));

      claimables.forEach(claimable => expect(claimable).to.be.bignumber.equal(tokenAmount.toFixed(MTON_UNIT)));
      balances.forEach(balance => expect(balance).to.be.bignumber.equal(tokenAmount.toFixed(MTON_UNIT)));
    });
  });

  describe('#setBalanceMulti', function () {
    it('owner can set claimable token amount', async function () {
      const amounts = range(accounts.length).map(_ => tokenAmount.toFixed(MTON_UNIT));

      await this.migrator.setBalanceMulti(accounts, amounts);

      const claimables = await Promise.all(accounts.map(account => this.migrator.claimable(account)));
      const balances = await Promise.all(accounts.map(account => this.migrator.balances(account)));

      claimables.forEach(claimable => expect(claimable).to.be.bignumber.equal(tokenAmount.toFixed(MTON_UNIT)));
      balances.forEach(balance => expect(balance).to.be.bignumber.equal(tokenAmount.toFixed(MTON_UNIT)));
    });
  });

  describe('after claimable tokens are set', function () {
    beforeEach(async function () {
      const amounts = range(accounts.length).map(_ => tokenAmount.toFixed(MTON_UNIT));

      await this.migrator.setBalanceMulti(accounts, amounts);
    });

    it('user can claim all tokens', async function () {
      await Promise.all(accounts.map(async (account) => {
        await this.migrator.claimAll({ from: account });

        expect(await this.migrator.claimable(account)).to.be.bignumber.equal('0');
        expect(await this.migrator.claimed(account)).to.be.bignumber.equal(tokenAmount.toFixed(MTON_UNIT));

        const mtonBalance = await this.mton.balanceOf(account);
        expect(mtonBalance).to.be.bignumber.equal(tokenAmount.toFixed(MTON_UNIT));
      }));
    });

    it('user can claim partial amount of tokens', async function () {
      const amount = tokenAmount.div('2');

      await Promise.all(accounts.map(async (account) => {
        // 1st claim
        await this.migrator.claim(amount.toFixed(MTON_UNIT), { from: account });
        expect(await this.migrator.claimable(account)).to.be.bignumber.equal(amount.toFixed(MTON_UNIT));
        expect(await this.migrator.claimed(account)).to.be.bignumber.equal(amount.toFixed(MTON_UNIT));

        expect(await this.mton.balanceOf(account))
          .to.be.bignumber.equal(amount.toFixed(MTON_UNIT));

        // 2nd claim
        await this.migrator.claim(amount.toFixed(MTON_UNIT), { from: account });
        expect(await this.migrator.claimable(account)).to.be.bignumber.equal('0');
        expect(await this.migrator.claimed(account)).to.be.bignumber.equal(tokenAmount.toFixed(MTON_UNIT));

        expect(await this.mton.balanceOf(account))
          .to.be.bignumber.equal(tokenAmount.toFixed(MTON_UNIT));

        // 3rd claim (revert)
        await expectRevert(
          this.migrator.claim('1', { from: account }),
          'MTONMigrator: amount exceeds balances',
        );
      }));
    });

    it('user cannot claim tokens over claimable amount', async function () {
      const amount = tokenAmount.plus(_MTON('0.01'));

      await Promise.all(accounts.map(async (account) => {
        await expectRevert(
          this.migrator.claim(amount.toFixed(MTON_UNIT), { from: account }),
          'MTONMigrator: amount exceeds balances',
        );

        expect(await this.migrator.claimable(account)).to.be.bignumber.equal(tokenAmount.toFixed(MTON_UNIT));
        expect(await this.migrator.claimed(account)).to.be.bignumber.equal('0');

        expect(await this.mton.balanceOf(account))
          .to.be.bignumber.equal('0');
      }));
    });
  });
});
