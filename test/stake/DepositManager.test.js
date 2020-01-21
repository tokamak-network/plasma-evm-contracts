const { range, last, first } = require('lodash');

const { createCurrency } = require('@makerdao/currency');
const {
  defaultSender, accounts, contract, web3,
} = require('@openzeppelin/test-environment');
const {
  BN, constants, expectEvent, expectRevert, time, ether,
} = require('@openzeppelin/test-helpers');

const { padLeft } = require('../helpers/pad');
const { appendHex } = require('../helpers/appendHex');

const EpochHandler = contract.fromArtifact('EpochHandler');
const SubmitHandler = contract.fromArtifact('SubmitHandler');
const RootChain = contract.fromArtifact('RootChain');
const EtherToken = contract.fromArtifact('EtherToken');

const ERC20Mintable = contract.fromArtifact('ERC20Mintable');

const DepositManager = contract.fromArtifact('DepositManager');
const RootChainRegistry = contract.fromArtifact('RootChainRegistry');

const { expect } = require('chai')
  .use(require('chai-bn')(BN))
  .should();

const LOGTX = process.env.LOGTX || false;
const VERBOSE = process.env.VERBOSE || false;

const development = true;

const TON = createCurrency('TON');

const tokenAmount = TON('1000');

const [operator, tokenOwner] = accounts;

const dummyStatesRoot = '0xdb431b544b2f5468e3f771d7843d9c5df3b4edcf8bc1c599f18f0b4ea8709bc3';
const dummyTransactionsRoot = '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421';
const dummyReceiptsRoot = '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421';

const WITHDRAWAL_DELAY = 10;

describe('stake/DepositManager', function () {
  beforeEach(async function () {
    this.token = await ERC20Mintable.new();
    this.etherToken = await EtherToken.new(true, this.token.address, true);

    const epochHandler = await EpochHandler.new();
    const submitHandler = await SubmitHandler.new(epochHandler.address);

    this.rootchain = await RootChain.new(
      epochHandler.address,
      submitHandler.address,
      this.etherToken.address,
      development,
      1,
      dummyStatesRoot,
      dummyTransactionsRoot,
      dummyReceiptsRoot,
    );
    this.COST_NRB = await this.rootchain.COST_NRB();

    this.registry = await RootChainRegistry.new();
    this.depositManager = await DepositManager.new(
      this.token.address,
      this.registry.address,
      WITHDRAWAL_DELAY,
    );

    await this.token.mint(tokenOwner, tokenAmount.toFixed('ray'));
    await this.registry.register(this.rootchain.address);
  });

  describe('when the token owner tries to deposit', function () {
    beforeEach(async function () {
      await this.token.approve(this.depositManager.address, tokenAmount.toFixed('ray'), { from: tokenOwner });
    });

    it('should deposit TON', async function () {
      const { tx } = await this.depositManager.deposit(this.rootchain.address, tokenAmount.toFixed('ray'), { from: tokenOwner });

      await expectEvent.inTransaction(tx, this.token, 'Transfer', {
        from: tokenOwner,
        to: this.depositManager.address,
        value: tokenAmount.toFixed('ray'),
      });
    });

    // TODO: amount check
    describe('after the token owner deposits tokens', function () {
      beforeEach(async function () {
        await this.depositManager.deposit(this.rootchain.address, tokenAmount.toFixed('ray'), { from: tokenOwner });
      });

      describe('when the token owner tries to withdraw', function () {
        it('should make a withdrawal request', async function () {
          await this.depositManager.requestWithdrawal(this.rootchain.address, tokenAmount.toFixed('ray'), { from: tokenOwner });
        });

        describe('before WITHDRAWAL_DELAY blocks are mined', function () {
          beforeEach(async function () {
            await this.depositManager.requestWithdrawal(this.rootchain.address, tokenAmount.toFixed('ray'), { from: tokenOwner });
          });

          it('should not process withdrawal request', async function () {
            await expectRevert(
              this.depositManager.processRequest(this.rootchain.address, { from: tokenOwner }),
              'DepositManager: wait for withdrawal delay',
            );

            // console.log('receipt?', await this.depositManager.processRequest(this.rootchain.address, { from: tokenOwner }));
          });
        });

        describe('after WITHDRAWAL_DELAY blocks are mined', function () {
          beforeEach(async function () {
            await this.depositManager.requestWithdrawal(this.rootchain.address, tokenAmount.toFixed('ray'), { from: tokenOwner });
            await Promise.all(range(WITHDRAWAL_DELAY + 1).map(_ => time.advanceBlock()));
          });

          it('should refund TON to the token owner', async function () {
            const { tx } = await this.depositManager.processRequest(this.rootchain.address, { from: tokenOwner });

            await expectEvent.inTransaction(tx, this.token, 'Transfer', {
              from: this.depositManager.address,
              to: tokenOwner,
              value: tokenAmount.toFixed('ray'),
            });
          });
        });
      });
    });
  });
});
