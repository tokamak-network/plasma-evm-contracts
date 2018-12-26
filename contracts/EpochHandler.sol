pragma solidity ^0.4.24;

import "./lib/SafeMath.sol";
import "./lib/Math.sol";
import "./lib/Data.sol";
import "./lib/Address.sol";
import "./lib/BMT.sol";

import "./RootChainStorage.sol";
import "./RootChainEvent.sol";


contract EpochHandler is RootChainStorage, RootChainEvent {
  using SafeMath for uint;
  using SafeMath for uint64;
  using Math for *;
  using Data for *;
  using Address for address;
  using BMT for *;

  constructor() public {
    epochHandler = this;
  }

  /**
   * @notice Declare to submit URB.
   */
  function prepareToSubmitURB()
    public
    payable
  {
    Data.Fork storage cur = forks[currentFork];
    Data.Fork storage next = forks[currentFork + 1];

    bool firstUAF = currentFork == 0;

    cur.forkedBlock = cur.lastFinalizedBlock + 1;
    next.firstBlock = cur.forkedBlock;
    next.firstEpoch = cur.blocks[next.firstBlock].epochNumber;

    next.lastEpoch = next.firstEpoch;
    next.timestamp = uint64(block.timestamp);

    // prepare URE
    Data.Epoch storage epoch = next.epochs[next.firstEpoch];

    epoch.initialized = true;
    epoch.timestamp = uint64(block.timestamp);
    epoch.isRequest = true;
    epoch.userActivated = true;

    epoch.requestStart = firstUAF ? 0 : cur.epochs[cur.firstEpoch].requestEnd + 1;
    epoch.requestEnd = uint64(ERUs.length - 1);

    assert(epoch.requestStart <= epoch.requestEnd);

    uint64 numBlocks = uint64(Data.calcNumBlock(epoch.requestStart, epoch.requestEnd));
    epoch.startBlockNumber = next.firstBlock;
    epoch.endBlockNumber = epoch.startBlockNumber
      .add64(numBlocks)
      .sub64(1);

    epoch.firstRequestBlockId = firstUAF ? 0 :
      cur.epochs[cur.firstEpoch].firstRequestBlockId
        .add64(
          cur.epochs[cur.firstEpoch].endBlockNumber
            .sub64(cur.epochs[cur.firstEpoch].startBlockNumber)
            .add64(1)
        );

    // TODO: It would be better to store the data in RequestBlock, reducing 3 SSTORE to 1 SSTORE
    for (uint64 i = 0; i < numBlocks; i++) {
      next.blocks[epoch.startBlockNumber.add64(i)].isRequest = true;
      next.blocks[epoch.startBlockNumber.add64(i)].userActivated = true;
      next.blocks[epoch.startBlockNumber.add64(i)].requestBlockId = epoch.firstRequestBlockId + i;
    }

    emit EpochPrepared(
      currentFork + 1,
      next.lastEpoch,
      epoch.startBlockNumber,
      epoch.endBlockNumber,
      epoch.requestStart,
      epoch.requestEnd,
      false,
      epoch.isRequest,
      epoch.userActivated,
      epoch.rebase
    );

    return;
  }

  /**
   * @notice prepare to submit ORB. It prevents further new requests from
   * being included in the request blocks in the just next ORB epoch.
   */
  function _prepareToSubmitORB() public payable {
    Data.Fork storage fork = forks[currentFork];

    require(currentFork == 0 || fork.rebased);

    fork.lastEpoch += 1;
    Data.Epoch storage epoch = fork.epochs[fork.lastEpoch];

    epoch.startBlockNumber = fork.epochs[fork.lastEpoch - 1].endBlockNumber + 1;

    epoch.isRequest = true;
    epoch.initialized = true;
    epoch.timestamp = uint64(block.timestamp);

    epoch.numEnter = uint64(numEnterForORB);
    numEnterForORB = 0;

    // link first enter epoch and last enter epoch
    if (epoch.numEnter > 0) {
      if (fork.firstEnterEpoch == 0) {
        fork.firstEnterEpoch = fork.lastEpoch;
      } else {
        fork.epochs[fork.lastEnterEpoch].nextEnterEpoch = fork.lastEpoch;
      }
      fork.lastEnterEpoch = fork.lastEpoch;
    }

    _checkPreviousORBEpoch(epoch);

    if (epoch.isEmpty) {
      epoch.requestEnd = epoch.requestStart;
      // epoch.startBlockNumber = epoch.startBlockNumber.sub64(1);
      epoch.startBlockNumber = epoch.startBlockNumber - 1;
      epoch.endBlockNumber = epoch.startBlockNumber;
    } else {
      epoch.requestEnd = uint64(EROs.length - 1);
      epoch.endBlockNumber = uint64(epoch.startBlockNumber + uint(epoch.requestEnd - epoch.requestStart + uint64(1))
        .divCeil(Data.MAX_REQUESTS()) - 1);
    }

    emit EpochPrepared(
      currentFork,
      fork.lastEpoch,
      epoch.startBlockNumber,
      epoch.endBlockNumber,
      epoch.requestStart,
      epoch.requestEnd,
      epoch.isEmpty,
      true,
      false,
      epoch.rebase
    );

    // no ORB to submit
    if (epoch.isEmpty) {
      _prepareToSubmitNRB();
    } else {
      uint numBlocks = epoch.getNumBlocks();
      for (uint64 i = 0; i < numBlocks; i++) {
        fork.blocks[epoch.startBlockNumber.add64(i)].isRequest = true;
        fork.blocks[epoch.startBlockNumber.add64(i)].requestBlockId = epoch.firstRequestBlockId + i;
      }
    }
  }

  function _checkPreviousORBEpoch(Data.Epoch storage epoch) internal {
    // short circuit if there is no request at all
    if (EROs.length == 0) {
      epoch.isEmpty = true;
      return;
    }

    Data.Fork storage fork = forks[currentFork];
    Data.Epoch storage previousRequestEpoch = fork.epochs[fork.lastEpoch - 2];

    // if the epoch is the first ORE (not ORE') afeter forked
    if (fork.rebased && fork.lastEpoch == fork.firstEpoch + 4) {
      // URE - ORE' - NRE' - NRE - ORE(lastEpoch)
      previousRequestEpoch = fork.epochs[fork.lastEpoch - 3];
    }

    if (EROs.length - 1 == uint(previousRequestEpoch.requestEnd)) {
      epoch.isEmpty = true;
    }

    // short circuit because epoch#0(previousRequestEpoch) is not a request epoch
    if (currentFork == 2) {
      return;
    }

    if (epoch.isEmpty) {
      epoch.requestStart = previousRequestEpoch.requestEnd;

      if (previousRequestEpoch.isEmpty) {
        epoch.firstRequestBlockId = previousRequestEpoch.firstRequestBlockId;
      } else {
        epoch.firstRequestBlockId = previousRequestEpoch.firstRequestBlockId + uint64(previousRequestEpoch.getNumBlocks());
      }
    } else {
      // if there is no filled ORB epoch, this is the first one
      if (firstFilledORBEpochNumber[currentFork] == 0) {
        firstFilledORBEpochNumber[currentFork] = fork.lastEpoch;
      } else {
        // set requestStart, firstRequestBlockId based on previousRequestEpoch
        if (previousRequestEpoch.isEmpty) {
          epoch.requestStart = previousRequestEpoch.requestEnd;
          epoch.firstRequestBlockId = previousRequestEpoch.firstRequestBlockId;
        } else {
          epoch.requestStart = previousRequestEpoch.requestEnd + 1;
          epoch.firstRequestBlockId = previousRequestEpoch.firstRequestBlockId + uint64(previousRequestEpoch.getNumBlocks());
        }
      }
    }

    // seal last ORB
    if (ORBs.length > 0) {
      ORBs[ORBs.length.sub(1)].submitted = true;
    }
  }

  function _prepareToSubmitNRB() public payable {
    Data.Fork storage fork = forks[currentFork];

    require(currentFork == 0 || fork.rebased);

    fork.lastEpoch += 1;
    Data.Epoch storage epoch = fork.epochs[fork.lastEpoch];

    uint startBlockNumber = 1;

    if (fork.lastEpoch != 1) {
      startBlockNumber = fork.epochs[fork.lastEpoch - 1].endBlockNumber + 1;
    }

    epoch.initialized = true;
    epoch.timestamp = uint64(block.timestamp);

    epoch.startBlockNumber = uint64(startBlockNumber);
    epoch.endBlockNumber = uint64(startBlockNumber + NRELength - 1);

    emit EpochPrepared(
      currentFork,
      fork.lastEpoch,
      epoch.startBlockNumber,
      epoch.endBlockNumber,
      0,
      0,
      false,
      false,
      false,
      epoch.rebase
    );
  }

  function _prepareOREAfterURE() public payable {
    Data.Fork storage _f = forks[currentFork];
    bool isOREEmpty = _f.prepareOREAfterURE(forks[currentFork.sub(1)], ORBs, _getLatestRequestInfo);
    uint lastEpochNumber = _f.lastEpoch;

    emit EpochPrepared(
      currentFork,
      lastEpochNumber,
      _f.epochs[lastEpochNumber].startBlockNumber,
      _f.epochs[lastEpochNumber].endBlockNumber,
      _f.epochs[lastEpochNumber].requestStart,
      _f.epochs[lastEpochNumber].requestEnd,
      isOREEmpty,
      true,
      false,
      true
    );

    if (isOREEmpty) {
      // set end block number of ORE' because it is 0. see EpochPrepared event.
      _f.epochs[lastEpochNumber].endBlockNumber = _f.lastBlock;

      emit EpochRebased(
        currentFork,
        lastEpochNumber,
        _f.epochs[lastEpochNumber].startBlockNumber,
        _f.epochs[lastEpochNumber].endBlockNumber,
        _f.epochs[lastEpochNumber].requestStart,
        _f.epochs[lastEpochNumber].requestEnd,
        true,
        true,
        false
      );

      _prepareNREAfterURE();
    }
  }

  /**
   * @notice get latest ORE, ORE' info
   */
  function _getLatestRequestInfo()
    internal
    returns (
      uint64 requestBlockId,
      uint64 requestStart,
      uint64 requestEnd
    ) {
    uint forkNumber = currentFork.sub(1);

    while (true) {
      Data.Fork storage fork = forks[forkNumber];
      uint latestRequestEpochNumber = fork.epochs[fork.lastEpoch].isRequest ?
        fork.lastEpoch :
        fork.lastEpoch - 1;

      if (fork.epochs[latestRequestEpochNumber].initialized) {
        uint firstRequestEpochNumber = fork.blocks[fork.forkedBlock].epochNumber;

        if (!fork.epochs[firstRequestEpochNumber].isRequest) {
          firstRequestEpochNumber += 1;
        }

        Data.Epoch storage firstRequestEpoch = fork.epochs[firstRequestEpochNumber];
        Data.Epoch storage latestRequestEpoch = fork.epochs[latestRequestEpochNumber];

        return (
          fork.blocks[latestRequestEpoch.startBlockNumber].requestBlockId,
          firstRequestEpoch.requestStart,
          latestRequestEpoch.requestEnd
        );
      }

      forkNumber = forkNumber.sub(1);
    }
  }

  function _prepareNREAfterURE() public payable {
    Data.Fork storage _f = forks[currentFork];
    bool isNREEmpty = _f.prepareNREAfterURE(forks[currentFork.sub(1)]);
    uint lastEpochNumber = _f.lastEpoch;

    emit EpochPrepared(
      currentFork,
      lastEpochNumber,
      _f.epochs[lastEpochNumber].startBlockNumber,
      0,
      0,
      0,
      isNREEmpty,
      false,
      false,
      true
    );

    if (isNREEmpty) {
      // set end block number of NRE' because it is 0. see EpochPrepared event.
      _f.epochs[lastEpochNumber].endBlockNumber = _f.lastBlock;
      _f.rebased = true;

      emit EpochRebased(
        currentFork,
        lastEpochNumber,
        _f.epochs[lastEpochNumber].startBlockNumber,
        _f.epochs[lastEpochNumber].endBlockNumber,
        _f.epochs[lastEpochNumber].requestStart,
        _f.epochs[lastEpochNumber].requestEnd,
        true,
        false,
        false
      );
      _prepareToSubmitNRB();
    }
  }
}