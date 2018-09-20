const { marshalString, unmarshalString } = require('./helpers/marshal');
const { padLeft, padRight } = require('./helpers/pad');

const MerkleTest = artifacts.require('MerkleTest');

require('chai')
  .use(require('chai-bignumber')(web3.BigNumber))
  .should();

contract('MerkleTest', () => {
  let merkle;

  const leaf = padRight('0xdead');
  const leaves = [];

  describe('description', () => {
    before(async () => {
      merkle = await MerkleTest.new();
    });

    it('add one leaf', async () => {
      leaves.push(leaf);

      await merkle.addLeaf(leaf);
      (await merkle.getLeavesCount()).should.be.bignumber.equal(leaves.length);

      await merkle.setRoot();
      (await merkle.leaves(0)).should.be.equal(leaf);
      (await merkle.getRoot()).should.be.equal(merkleLeaves(leaves));
    });

    it('add another leaf', async () => {
      leaves.push(leaf);

      await merkle.addLeaf(leaf);
      (await merkle.getLeavesCount()).should.be.bignumber.equal(leaves.length);

      await merkle.setRoot();
      (await merkle.getRoot()).should.be.equal(merkleLeaves(leaves));
    });

    it('add another leaf', async () => {
      leaves.push(leaf);

      await merkle.addLeaf(leaf);
      (await merkle.getLeavesCount()).should.be.bignumber.equal(leaves.length);

      await merkle.setRoot();
      (await merkle.getRoot()).should.be.equal(merkleLeaves(leaves));
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
