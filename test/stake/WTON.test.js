const { range, last, first } = require('lodash');

const { createCurrency } = require('@makerdao/currency');
const {
  defaultSender, accounts, contract, web3,
} = require('@openzeppelin/test-environment');
const {
  BN, constants, expectEvent, expectRevert, time, ether,
} = require('@openzeppelin/test-helpers');

const WTON = contract.fromArtifact('WTON');
const TON = contract.fromArtifact('TON');

const EpochHandler = contract.fromArtifact('EpochHandler');
const SubmitHandler = contract.fromArtifact('SubmitHandler');
const Layer2 = contract.fromArtifact('Layer2');
const EtherToken = contract.fromArtifact('EtherToken');

const DepositManager = contract.fromArtifact('DepositManager');
const SeigManager = contract.fromArtifact('SeigManager');
const Layer2Registry = contract.fromArtifact('Layer2Registry');

const chai = require('chai');
const { expect } = chai;

chai.use(require('chai-bn')(BN))
  .should();

const LOGTX = process.env.LOGTX || false;
const VERBOSE = process.env.VERBOSE || false;

const development = true;

const _TON = createCurrency('TON');
const _WTON = createCurrency('WTON');

const TON_UNIT = 'wei';
const WTON_UNIT = 'ray';

const [receiver] = accounts;

const dummyStatesRoot = '0xdb431b544b2f5468e3f771d7843d9c5df3b4edcf8bc1c599f18f0b4ea8709bc3';
const dummyTransactionsRoot = '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421';
const dummyReceiptsRoot = '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421';

const tokenAmount = _TON('1000');

describe('stake/WTON', function () {
  beforeEach(async function () {
    this.ton = await TON.new();
    this.wton = await WTON.new(this.ton.address);
  });

  beforeEach(async function () {
    await this.ton.approve(this.wton.address, tokenAmount.toFixed(TON_UNIT));
  });

  describe('when swap TON to WTON', function () {
    beforeEach(async function () {
      await this.ton.mint(defaultSender, tokenAmount.toFixed(TON_UNIT));
    });

    it('should swap TON to WTON', async function () {
      expect(await this.ton.balanceOf(defaultSender)).to.be.bignumber.equal(tokenAmount.toFixed(TON_UNIT));
      expect(await this.wton.balanceOf(defaultSender)).to.be.bignumber.equal('0');

      await this.wton.swapFromTON(tokenAmount.toFixed(TON_UNIT));

      expect(await this.ton.balanceOf(defaultSender)).to.be.bignumber.equal('0');
      expect(await this.wton.balanceOf(defaultSender)).to.be.bignumber.equal(tokenAmount.toFixed(WTON_UNIT));
    });

    it('should swap TON to WTON with transferring swapped WTON', async function () {
      expect(await this.ton.balanceOf(defaultSender)).to.be.bignumber.equal(tokenAmount.toFixed(TON_UNIT));
      expect(await this.wton.balanceOf(defaultSender)).to.be.bignumber.equal('0');
      expect(await this.wton.balanceOf(receiver)).to.be.bignumber.equal('0');

      await this.wton.swapFromTONAndTransfer(receiver, tokenAmount.toFixed(TON_UNIT));

      expect(await this.ton.balanceOf(defaultSender)).to.be.bignumber.equal('0');
      expect(await this.wton.balanceOf(defaultSender)).to.be.bignumber.equal('0');
      expect(await this.wton.balanceOf(receiver)).to.be.bignumber.equal(tokenAmount.toFixed(WTON_UNIT));
    });
  });

  describe('when swap WTON to TON', function () {
    beforeEach(async function () {
      await this.ton.mint(defaultSender, tokenAmount.toFixed(TON_UNIT));
      await this.wton.swapFromTON(tokenAmount.toFixed(TON_UNIT));
    });

    it('should swap WTON to TON', async function () {
      expect(await this.ton.balanceOf(defaultSender)).to.be.bignumber.equal('0');
      expect(await this.wton.balanceOf(defaultSender)).to.be.bignumber.equal(tokenAmount.toFixed(WTON_UNIT));

      await this.wton.swapToTON(tokenAmount.toFixed(WTON_UNIT));

      expect(await this.ton.balanceOf(defaultSender)).to.be.bignumber.equal(tokenAmount.toFixed(TON_UNIT));
      expect(await this.wton.balanceOf(defaultSender)).to.be.bignumber.equal('0');
    });

    it('should swap WTON to TON with transferring swapped TON', async function () {
      expect(await this.ton.balanceOf(defaultSender)).to.be.bignumber.equal('0');
      expect(await this.wton.balanceOf(defaultSender)).to.be.bignumber.equal(tokenAmount.toFixed(WTON_UNIT));
      expect(await this.ton.balanceOf(receiver)).to.be.bignumber.equal('0');

      await this.wton.swapToTONAndTransfer(receiver, tokenAmount.toFixed(WTON_UNIT));

      expect(await this.ton.balanceOf(defaultSender)).to.be.bignumber.equal('0');
      expect(await this.wton.balanceOf(defaultSender)).to.be.bignumber.equal('0');
      expect(await this.ton.balanceOf(receiver)).to.be.bignumber.equal(tokenAmount.toFixed(TON_UNIT));
    });
  });
});
