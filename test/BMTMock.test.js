const { marshalString, unmarshalString } = require('./helpers/marshal');
const { padLeft, padRight } = require('./helpers/pad');

const BMTMock = artifacts.require('BMTMock');

require('chai')
  .use(require('chai-bignumber')(web3.BigNumber))
  .should();

const leaf = padLeft('0xdead');
const roots = {
  1: leaf,
  2: '0x0af3feac67a59f8a6c839e5e7d85e7aa16d8569a0bbed85ae2204fa465300dde',
  10: '0x40f0a1fe3c6023fac1363e8ab9f303422a86f17df1d7c51a8a45a46fa76b3675',
  100: '0x098095028c5a5bd103ad3984aafc50ce2c04edcf65b5fdbdc359fc9d0d4a0618',
};

contract('BMTMock', () => {
  let merkle;

  const leaves = [];

  describe('merkle root', () => {
    before(async () => {
      merkle = await BMTMock.new();
    });

    it('1 leaf', async () => {
      leaves.push(leaf);

      await merkle.addLeaf(leaf);
      (await merkle.getLeavesCount()).should.be.bignumber.equal(leaves.length);

      await merkle.setRoot();
      (await merkle.leaves(0)).should.be.equal(leaf);
      (await merkle.getRoot()).should.be.equal(roots[leaves.length]);
    });

    it('2 leaves', async () => {
      leaves.push(leaf);

      await merkle.addLeaf(leaf);
      (await merkle.getLeavesCount()).should.be.bignumber.equal(leaves.length);

      await merkle.setRoot();
      (await merkle.getRoot()).should.be.equal(roots[leaves.length]);
    });

    it('10 leaves', async () => {
      const N = 10 - leaves.length;
      const leavesN = [];
      for (let i = 0; i < N; i++) {
        leaves.push(leaf);
        leavesN.push(leaf);
      }

      await merkle.addLeaves(leavesN);
      (await merkle.getLeavesCount()).should.be.bignumber.equal(leaves.length);

      await merkle.setRoot();
      (await merkle.getRoot()).should.be.equal(roots[leaves.length]);
    });

    it('100 leaves', async () => {
      const N = 100 - leaves.length;
      const leavesN = [];
      for (let i = 0; i < N; i++) {
        leaves.push(leaf);
        leavesN.push(leaf);
      }

      await merkle.addLeaves(leavesN);
      (await merkle.getLeavesCount()).should.be.bignumber.equal(leaves.length);

      await merkle.setRoot();
      (await merkle.getRoot()).should.be.equal(roots[leaves.length]);
    });

    it('add other 10 leaves', async () => {
      const N = 10;
      const leavesN = [];
      for (let i = 0; i < N; i++) {
        leaves.push(leaf);
        leavesN.push(leaf);
      }

      await merkle.addLeaves(leavesN);
      (await merkle.getLeavesCount()).should.be.bignumber.equal(leaves.length);

      await merkle.setRoot();
      (await merkle.getRoot()).should.be.equal(merkleLeaves(leaves));
    });

    for (let i = 0; i < 10; i++) {
      it('add other 100 leaves', async () => {
        const N = 100;
        const leavesN = [];
        for (let i = 0; i < N; i++) {
          leaves.push(leaf);
          leavesN.push(leaf);
        }

        await merkle.addLeaves(leavesN);
        (await merkle.getLeavesCount()).should.be.bignumber.equal(leaves.length);

        await merkle.setRoot();
        (await merkle.getRoot()).should.be.equal(merkleLeaves(leaves));
      });
    }
  });
});

function merkleStr (hexStr1, hexStr2) {
  const str = unmarshalString(hexStr1) + unmarshalString(hexStr2);
  return web3.sha3(str, { encoding: 'hex' });
}

function merkleLeaves (leaves) {
  if (leaves.length === 1) return leaves[0];

  const nextLeaves = [];
  let i = 0;

  for (; i + 1 < leaves.length; i += 2) {
    nextLeaves.push(merkleStr(leaves[i], leaves[i + 1]));
  }

  if (leaves.length % 2 === 1) {
    nextLeaves.push(merkleStr(leaves[leaves.length - 1], leaves[leaves.length - 1]));
  }

  return merkleLeaves(nextLeaves);
}
