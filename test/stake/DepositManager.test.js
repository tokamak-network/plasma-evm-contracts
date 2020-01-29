const { range, last, first } = require('lodash');

const { createCurrency, createCurrencyRatio } = require('@makerdao/currency');
const {
  defaultSender, accounts, contract, web3,
} = require('@openzeppelin/test-environment');
const {
  BN, constants, expectEvent, expectRevert, time, ether,
} = require('@openzeppelin/test-helpers');

const { padLeft } = require('../helpers/pad');
const { appendHex } = require('../helpers/appendHex');

const WTON = contract.fromArtifact('WTON');
const TON = contract.fromArtifact('TON');

const EpochHandler = contract.fromArtifact('EpochHandler');
const SubmitHandler = contract.fromArtifact('SubmitHandler');
const RootChain = contract.fromArtifact('RootChain');
const EtherToken = contract.fromArtifact('EtherToken');

const DepositManager = contract.fromArtifact('DepositManager');
const SeigManager = contract.fromArtifact('SeigManager');
const RootChainRegistry = contract.fromArtifact('RootChainRegistry');
const CustomIncrementCoinage = contract.fromArtifact('CustomIncrementCoinage');

const { expect } = require('chai')
  .use(require('chai-bn')(BN))
  .should();

const LOGTX = process.env.LOGTX || false;
const VERBOSE = process.env.VERBOSE || false;

const development = true;

const _WTON = createCurrency('WTON');

const WTON_UNIT = 'ray';

const [operator, tokenOwner] = accounts;

const dummyStatesRoot = '0xdb431b544b2f5468e3f771d7843d9c5df3b4edcf8bc1c599f18f0b4ea8709bc3';
const dummyTransactionsRoot = '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421';
const dummyReceiptsRoot = '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421';

const initialSupply = _WTON('1000');
const tokenAmount = initialSupply.div(100);
const WITHDRAWAL_DELAY = 10;

describe('stake/DepositManager', function () {
  beforeEach(async function () {
    this.ton = await TON.new();
    this.wton = await WTON.new(this.ton.address);

    this.etherToken = await EtherToken.new(true, this.ton.address, true);

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

    this.registry = await RootChainRegistry.new();

    this.depositManager = await DepositManager.new(
      this.wton.address,
      this.registry.address,
      WITHDRAWAL_DELAY,
    );

    this.seigManager = await SeigManager.new(
      this.ton.address,
      this.wton.address,
      this.registry.address,
      this.depositManager.address,
      _WTON('100').toFixed(WTON_UNIT),
    );

    // add WSTON minter role to seig manager
    await this.wton.addMinter(this.seigManager.address);

    // set seig manager to contracts
    await Promise.all([
      this.depositManager,
      this.ton,
      this.wton,
    ].map(contract => contract.setSeigManager(this.seigManager.address)));
    await this.rootchain.setSeigManager(this.seigManager.address);

    // register root chain and deploy coinage
    await this.registry.registerAndDeployCoinage(this.rootchain.address, this.seigManager.address);

    // mint WTON to account
    await this.wton.mint(tokenOwner, initialSupply.toFixed(WTON_UNIT));

    // load coinage and tot
    this.coinage = await CustomIncrementCoinage.at(await this.seigManager.coinages(this.rootchain.address));
    this.tot = await CustomIncrementCoinage.at(await this.seigManager.tot());
  });

  describe('when the token owner tries to deposit', function () {
    beforeEach(async function () {
      await this.wton.approve(this.depositManager.address, tokenAmount.toFixed(WTON_UNIT), { from: tokenOwner });
    });

    it('should deposit WTON', async function () {
      const { tx } = await this.depositManager.deposit(this.rootchain.address, tokenAmount.toFixed(WTON_UNIT), { from: tokenOwner });

      await expectEvent.inTransaction(tx, this.wton, 'Transfer', {
        from: tokenOwner,
        to: this.depositManager.address,
        value: tokenAmount.toFixed(WTON_UNIT),
      });
    });

    // TODO: amount check
    describe('after the token owner deposits tokens', function () {
      beforeEach(async function () {
        await this.depositManager.deposit(this.rootchain.address, tokenAmount.toFixed(WTON_UNIT), { from: tokenOwner });
      });

      describe('when the token owner tries to withdraw', function () {
        it('should make a withdrawal request', async function () {
          console.log(`
tot     total supply            : ${(await this.tot.totalSupply()).toString(10).padStart(35)}
coinage total supply            : ${(await this.coinage.totalSupply()).toString(10).padStart(35)}
tot     balance of root chian   : ${(await this.tot.balanceOf(this.rootchain.address)).toString(10).padStart(35)}
coinage balance of tokwn owner  : ${(await this.coinage.balanceOf(tokenOwner)).toString(10).padStart(35)}

additionalTotBurnAmount         : ${(await this.seigManager.additionalTotBurnAmount(this.rootchain.address, tokenOwner, tokenAmount.toFixed(WTON_UNIT))).toString(10).padStart(35)}

          `);

          await this.depositManager.requestWithdrawal(this.rootchain.address, tokenAmount.toFixed(WTON_UNIT), { from: tokenOwner });
        });

        describe('before WITHDRAWAL_DELAY blocks are mined', function () {
          beforeEach(async function () {
            await this.depositManager.requestWithdrawal(this.rootchain.address, tokenAmount.toFixed(WTON_UNIT), { from: tokenOwner });
          });

          it('should not process withdrawal request', async function () {
            await expectRevert(
              this.depositManager.processRequest(this.rootchain.address, { from: tokenOwner }),
              'DepositManager: wait for withdrawal delay',
            );
          });
        });

        describe('after WITHDRAWAL_DELAY blocks are mined', function () {
          beforeEach(async function () {
            await this.depositManager.requestWithdrawal(this.rootchain.address, tokenAmount.toFixed(WTON_UNIT), { from: tokenOwner });
            await Promise.all(range(WITHDRAWAL_DELAY + 1).map(_ => time.advanceBlock()));
          });

          it('should withdraw WTON to the token owner', async function () {
            const { tx } = await this.depositManager.processRequest(this.rootchain.address, { from: tokenOwner });

            await expectEvent.inTransaction(tx, this.wton, 'Transfer', {
              from: this.depositManager.address,
              to: tokenOwner,
              value: tokenAmount.toFixed(WTON_UNIT),
            });
          });
        });

        describe('when the token owner make 2 requests', function () {
          const amount = tokenAmount.div(2);

          beforeEach(async function () {
            for (const _ of range(2)) {
              await this.depositManager.requestWithdrawal(this.rootchain.address, amount.toFixed(WTON_UNIT), { from: tokenOwner });
            }
          });

          describe('before WITHDRAWAL_DELAY blocks are mined', function () {
            it('should not process withdrawal request', async function () {
              await expectRevert(
                this.depositManager.processRequest(this.rootchain.address, { from: tokenOwner }),
                'DepositManager: wait for withdrawal delay',
              );
            });
          });

          describe('after WITHDRAWAL_DELAY blocks are mined', function () {
            beforeEach(async function () {
              await Promise.all(range(WITHDRAWAL_DELAY + 1).map(_ => time.advanceBlock()));
            });

            it('should process 2 requests', async function () {
              for (const _ of range(2)) {
                const { tx } = await this.depositManager.processRequest(this.rootchain.address, { from: tokenOwner });

                await expectEvent.inTransaction(tx, this.wton, 'Transfer', {
                  from: this.depositManager.address,
                  to: tokenOwner,
                  value: amount.toFixed(WTON_UNIT),
                });
              }
            });
          });
        });
      });
    });
  });
});
