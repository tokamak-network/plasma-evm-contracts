pragma solidity ^0.5.12;

import "../lib/SafeMath.sol";
import "../lib/Math.sol";
import "../lib/Data.sol";
import "../lib/Address.sol";
import "../lib/BMT.sol";

import "../Layer2Storage.sol";
import "../Layer2Event.sol";
import "../Layer2Base.sol";

import { SeigManagerI } from "../stake/interfaces/SeigManagerI.sol";


contract SubmitHandler is Layer2Storage, Layer2Event, Layer2Base {
  using SafeMath for uint;
  using SafeMath for uint64;
  using Math for *;
  using Data for *;
  using Address for address;
  using BMT for *;

  constructor(address _epochHandler) public {
    epochHandler = _epochHandler;
    submitHandler = address(this);
  }

  function submitNRE(
    uint _pos1, // forknumber + epochNumber
    uint _pos2, // startBlockNumber + endBlockNumber
    bytes32 _epochStateRoot,
    bytes32 _epochTransactionsRoot,
    bytes32 _epochReceiptsRoot
  )
    public
    payable
    returns (bool success)
  {
    (uint forkNumber, uint epochNumber) = _pos1.decodePos();
    require(currentFork == forkNumber, "currentFork == forkNumber");

    (uint startBlockNumber, uint endBlockNumber) = _pos2.decodePos();

    forks[forkNumber].insertNRE(
      epochNumber,
      _epochStateRoot,
      _epochTransactionsRoot,
      _epochReceiptsRoot,
      startBlockNumber,
      endBlockNumber
    );

    _delegatePrepareORE();

    if (address(seigManager) != address(0)) {
      require(SeigManagerI(seigManager).updateSeigniorage());
    }

    return true;
  }

  function submitORB(
    uint _pos,
    bytes32 _statesRoot,
    bytes32 _transactionsRoot,
    bytes32 _receiptsRoot
  )
    public
    payable
    returns (bool success)
  {
    uint forkNumber;
    uint blockNumber;

    (forkNumber, blockNumber) = _pos.decodePos();

    require(currentFork == forkNumber);
    require(forks[forkNumber].lastBlock + 1 == blockNumber);

    Data.Fork storage curFork = forks[forkNumber];

    uint epochNumber;
    uint requestBlockId;

    // If not forked or already rebased
    if (forkNumber == 0 || forks[forkNumber - 1].forkedBlock != 0 && curFork.rebased) {
      (epochNumber, blockNumber) = curFork.insertBlock(
        _statesRoot,
        _transactionsRoot,
        _receiptsRoot,
        true,
        false,
        false
      );

      if (!development) {
        _transactionsRoot._checkTxRoot(
          ORBs[curFork.blocks[curFork.lastBlock].requestBlockId],
          EROs,
          false
        );
      }

      requestBlockId = curFork.blocks[blockNumber].requestBlockId;

      // accunulate # of enters into epoch
      curFork.epochs[epochNumber].RE.numEnter += ORBs[requestBlockId].numEnter;

      emit BlockSubmitted(
        forkNumber,
        epochNumber,
        blockNumber,
        true,
        false
      );

      if (blockNumber == curFork.epochs[epochNumber].endBlockNumber) {
        _delegatePrepareNRE();
      }

      if (address(seigManager) != address(0)) {
        require(SeigManagerI(seigManager).updateSeigniorage());
      }

      return true;
    }

    // Otherwise, compare to block in previous fork
    (epochNumber, blockNumber) = curFork.insertBlock(
      _statesRoot,
      _transactionsRoot,
      _receiptsRoot,
      true,
      false,
      true
    );

    Data.Fork storage preFork = forks[forkNumber - 1];
    Data.PlasmaBlock storage curBlock = curFork.blocks[blockNumber];

    curBlock.referenceBlock = curFork.nextBlockToRebase;
    curBlock.requestBlockId = preFork.blocks[curFork.nextBlockToRebase].requestBlockId;

    if (!development) {
      _transactionsRoot._checkTxRoot(
        ORBs[curBlock.requestBlockId],
        EROs,
        true
      );
    }

    emit BlockSubmitted(
      forkNumber,
      epochNumber,
      blockNumber,
      true,
      false
    );

    // if ORB' is filled.
    if (curFork.checkNextORBToRebase(preFork, ORBs)) {
      curFork.epochs[epochNumber].endBlockNumber = uint64(blockNumber);

      emit EpochRebased(
        forkNumber,
        epochNumber,
        curFork.epochs[epochNumber].startBlockNumber,
        blockNumber,
        curFork.epochs[epochNumber].RE.requestStart,
        0,
        false,
        true,
        false
      );

      _delegatePrepareNREAfterURE();
    }

    if (address(seigManager) != address(0)) {
      require(SeigManagerI(seigManager).updateSeigniorage());
    }

    return true;
  }

  function submitURB(
    uint _pos,
    bytes32 _statesRoot,
    bytes32 _transactionsRoot,
    bytes32 _receiptsRoot
  )
    public
    payable
    returns (bool success)
  {
    uint forkNumber;
    uint blockNumber;

    (forkNumber, blockNumber) = _pos.decodePos();


    bool firstURB = currentFork + 1 == forkNumber;
    require(firstURB || currentFork == forkNumber);

    Data.Fork storage fork = forks[forkNumber];

    if (firstURB) {
      currentFork = forkNumber;
      fork = forks[forkNumber];

      require(fork.timestamp + Data.URE_TIMEOUT() > block.timestamp);

      // check block number
      require(blockNumber == fork.firstBlock);

      emit Forked(forkNumber, fork.lastEpoch, fork.firstBlock);
    } else {
      // check block number
      require(blockNumber == fork.lastBlock.add64(1));
    }

    Data.Epoch storage epoch = fork.epochs[fork.lastEpoch];

    require(epoch.isRequest);
    require(epoch.userActivated);

    Data.PlasmaBlock storage b = fork.blocks[blockNumber];

    b.epochNumber = fork.lastEpoch;
    b.statesRoot = _statesRoot;
    b.transactionsRoot = _transactionsRoot;
    b.receiptsRoot = _receiptsRoot;
    b.timestamp = uint64(block.timestamp);
    b.isRequest = true;
    b.userActivated = true;

    fork.lastBlock = uint64(blockNumber);

    if (!development) {
      _transactionsRoot._checkTxRoot(
        URBs[fork.blocks[fork.lastBlock].requestBlockId],
        ERUs,
        false
      );
    }

    emit BlockSubmitted(
      forkNumber,
      fork.lastEpoch,
      blockNumber,
      true,
      true
    );

    // TODO: use internal function to avoide stack too deep error
    if (blockNumber == epoch.endBlockNumber) {
      _delegatePrepareOREAfterURE();
    }

    if (address(seigManager) != address(0)) {
      require(SeigManagerI(seigManager).updateSeigniorage());
    }

    return true;
  }
}
