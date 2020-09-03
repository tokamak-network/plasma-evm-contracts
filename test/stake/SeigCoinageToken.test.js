const range = require('lodash/range');
const first = require('lodash/first');
const last = require('lodash/last');

const {
  defaultSender, accounts, contract, web3,
} = require('@openzeppelin/test-environment');
const {
  BN, constants, expectEvent, expectRevert, time, ether,
} = require('@openzeppelin/test-helpers');

const { padLeft, toBN } = require('web3-utils');
const chai = require('chai');
const { expect } = chai;
chai.use(require('chai-bn')(BN)).should();

const SeigCoinageToken = contract.fromArtifact('SeigCoinageTokenMock');

const [tokenOwner1, tokenOwner2] = accounts;

describe('stake/SeigCoinageToken', function () {
  beforeEach(async function () {
    this.coinage = await SeigCoinageToken.new();
  });

  describe('without seigniorage', async function () {
    beforeEach(async function () {
    });
    describe('mint', async function () {
      const amount = toBN('123456789');
      beforeEach(async function () {
        await this.coinage.mint(tokenOwner1, amount);
      });
      it('totalSupply', async function () {
        const totalSupply = await this.coinage.totalSupply();
        totalSupply.should.be.bignumber.equal(amount);
      });
      it('balanceOf', async function () {
        const balance = await this.coinage.balanceOf(tokenOwner1);
        balance.should.be.bignumber.equal(amount);
      });
    });
    describe('burn', async function () {
      const amount = toBN('123456789');
      beforeEach(async function () {
        await this.coinage.mint(tokenOwner1, amount);
        await this.coinage.burn(tokenOwner1, amount);
      });
      it('totalSupply', async function () {
        const totalSupply = await this.coinage.totalSupply();
        totalSupply.should.be.bignumber.equal(toBN('0'));
      });
      it('balanceOf', async function () {
        const balance = await this.coinage.balanceOf(tokenOwner1);
        balance.should.be.bignumber.equal(toBN('0'));
      });
    });
  });
  describe('with seigniorage', async function () {
    const amount1 = toBN('123456789');
    const amount2 = toBN('111111111');
    const seig = toBN('1111');
    beforeEach(async function () {
    });
    describe('mint', async function () {
      beforeEach(async function () {
        await this.coinage.mint(tokenOwner1, amount1);
        await this.coinage.mint(tokenOwner2, amount2);
      });
      it('totalSupply', async function () {
        const totalSupply = await this.coinage.totalSupply();
        totalSupply.should.be.bignumber.equal(amount1.add(amount2));

        await this.coinage.addSeigniorage(seig);

        const totalSupply2 = await this.coinage.totalSupply();
        totalSupply2.should.be.bignumber.equal(amount1.add(amount2).add(seig));
      });
      it('balanceOf', async function () {
        const balance1 = await this.coinage.balanceOf(tokenOwner1);
        balance1.should.be.bignumber.equal(amount1);
        const balance2 = await this.coinage.balanceOf(tokenOwner2);
        balance2.should.be.bignumber.equal(amount2);

        await this.coinage.addSeigniorage(seig);
        const seig1 = await this.coinage.getSeigniorage(tokenOwner1);
        seig1[0].should.be.bignumber.equal(seig.mul(amount1).div(amount1.add(amount2)));
        const seig2 = await this.coinage.getSeigniorage(tokenOwner2);
        seig2[0].should.be.bignumber.equal(seig.mul(amount2).div(amount1.add(amount2)));

        const balance3 = await this.coinage.balanceOf(tokenOwner1);
        balance3.should.be.bignumber.equal(amount1.add(seig1[0]));
        const balance4 = await this.coinage.balanceOf(tokenOwner2);
        balance4.should.be.bignumber.equal(amount2.add(seig2[0]));
      });
      it('updateSeigniorage', async function () {
        await this.coinage.addSeigniorage(seig);
        await this.coinage.updateSeigniorage(tokenOwner1);

        const balance1 = await this.coinage.balanceOf(tokenOwner1);
        balance1.should.be.bignumber.equal(amount1.add(seig.mul(amount1).div(amount1.add(amount2))));
        const balance2 = await this.coinage.balanceOf(tokenOwner2);
        balance2.should.be.bignumber.equal(amount2.add(seig.mul(amount2).div(amount1.add(amount2))));
      });
    });
    describe('burn', async function () {
      const amount1 = toBN('123456789');
      const amount2 = toBN('111111111');
      const seig = toBN('1111');
      beforeEach(async function () {
        await this.coinage.mint(tokenOwner1, amount1);
        await this.coinage.mint(tokenOwner2, amount2);
        await this.coinage.addSeigniorage(seig);
        await this.coinage.updateSeigniorage(tokenOwner1);
        await this.coinage.updateSeigniorage(tokenOwner2);
        await this.coinage.burn(tokenOwner1, amount1);
        await this.coinage.burn(tokenOwner2, amount2);
      });
      it('totalSupply', async function () {
        const totalSupply = await this.coinage.totalSupply();
        totalSupply.should.be.bignumber.equal(seig);
      });
      it('balanceOf', async function () {
        const balance1 = await this.coinage.balanceOf(tokenOwner1);
        balance1.should.be.bignumber.equal(seig.mul(amount1).div(amount1.add(amount2)));
        const balance2 = await this.coinage.balanceOf(tokenOwner2);
        balance2.should.be.bignumber.equal(seig.mul(amount2).div(amount1.add(amount2)));
      });
    });
  });
});
