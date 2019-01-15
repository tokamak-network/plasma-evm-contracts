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
    next.lastFinalizedBlock = cur.lastFinalizedBlock;
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
      next.firstEpoch,
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

    uint64 nextEpoch = fork.lastEpoch + 1;
    Data.Epoch storage epoch = fork.epochs[nextEpoch];
    Data.Epoch storage previousEpoch = fork.epochs[nextEpoch - 1];

    epoch.startBlockNumber = fork.epochs[fork.lastEpoch].endBlockNumber + 1;

    epoch.isRequest = true;
    epoch.initialized = true;
    epoch.timestamp = uint64(block.timestamp);

    epoch.numEnter = uint64(numEnterForORB);
    numEnterForORB = 0;

    // link first enter epoch and last enter epoch
    if (epoch.numEnter > 0) {
      if (fork.firstEnterEpoch == 0) {
        // NOTE: If chain is forked before the first block of the epoch is submitted,
        //       then fork.firstEnterEpoch > fork.lastEpoch
        fork.firstEnterEpoch = nextEpoch;
      } else {
        fork.epochs[fork.lastEnterEpoch].nextEnterEpoch = nextEpoch;
      }
      fork.lastEnterEpoch = nextEpoch;
    }

    _checkPreviousORBEpoch(epoch, nextEpoch);

    if (epoch.isEmpty) {
      epoch.requestEnd = epoch.requestStart;
      epoch.startBlockNumber = previousEpoch.endBlockNumber;
      epoch.endBlockNumber = epoch.startBlockNumber;
    } else {
      epoch.requestEnd = uint64(EROs.length - 1);
      epoch.startBlockNumber = previousEpoch.endBlockNumber + 1;
      epoch.endBlockNumber = uint64(epoch.startBlockNumber + uint(epoch.requestEnd - epoch.requestStart + uint64(1))
        .divCeil(Data.MAX_REQUESTS()) - 1);
    }

    emit EpochPrepared(
      currentFork,
      nextEpoch,
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
      fork.lastEpoch = nextEpoch;
      _prepareToSubmitNRB();
    } else {
      uint numBlocks = epoch.getNumBlocks();
      for (uint64 i = 0; i < numBlocks; i++) {
        fork.blocks[epoch.startBlockNumber.add64(i)].isRequest = true;
        fork.blocks[epoch.startBlockNumber.add64(i)].requestBlockId = epoch.firstRequestBlockId + i;
      }
    }
  }

  function _checkPreviousORBEpoch(Data.Epoch storage epoch, uint epochNumber) internal {
    // short circuit if there is no request at all
    if (EROs.length == 0) {
      epoch.isEmpty = true;
      return;
    }
    Data.Fork storage fork = forks[currentFork];

    // short curcit for ORE#2
    if (epochNumber - 2 == 0) {
      if (ORBs.length > 0) {
        ORBs[ORBs.length.sub(1)].submitted = true;
        firstFilledORENumber[currentFork] = epochNumber;
      } else {
        epoch.isEmpty = true;
      }
      return;
    }

    Data.Epoch storage previousRequestEpoch = fork.epochs[epochNumber - 2];

    if (fork.rebased && epochNumber == fork.firstEpoch + 4) {
      // if the epoch is the first ORE (not ORE') afeter forked
      // URE - ORE' - NRE' - NRE - ORE(lastEpoch)
      previousRequestEpoch = fork.epochs[epochNumber - 3];
    }

    require(previousRequestEpoch.isRequest);


    if (EROs.length - 1 == uint(previousRequestEpoch.requestEnd)) {
      epoch.isEmpty = true;
    }

    if (!epoch.isEmpty && firstFilledORENumber[currentFork] == 0) {
      firstFilledORENumber[currentFork] = epochNumber;
    }

    if (!epoch.isEmpty) {
      if (firstFilledORENumber[currentFork] == epochNumber && previousRequestEpoch.rebase) {
        epoch.requestStart = previousRequestEpoch.requestEnd + 1;
        epoch.firstRequestBlockId = previousRequestEpoch.firstRequestBlockId + 1;
      } else if (firstFilledORENumber[currentFork] == epochNumber) {
        epoch.requestStart = previousRequestEpoch.requestEnd;
        epoch.firstRequestBlockId = previousRequestEpoch.firstRequestBlockId;
      } else if (!previousRequestEpoch.isEmpty) {
        epoch.requestStart = previousRequestEpoch.requestStart + uint64(previousRequestEpoch.getNumRequests());
        epoch.firstRequestBlockId = previousRequestEpoch.firstRequestBlockId + uint64(previousRequestEpoch.getNumBlocks());
      } else {
        epoch.requestStart = previousRequestEpoch.requestEnd + 1;
        epoch.firstRequestBlockId = previousRequestEpoch.firstRequestBlockId + 1;
      }
    } else {
      epoch.requestStart = previousRequestEpoch.requestEnd;
      epoch.firstRequestBlockId = previousRequestEpoch.firstRequestBlockId;
    }

    // seal last ORB
    if (!epoch.isEmpty) {
      ORBs[ORBs.length.sub(1)].submitted = true;
    }
  }

  function _prepareToSubmitNRB() public payable {
    Data.Fork storage fork = forks[currentFork];

    require(currentFork == 0 || fork.rebased);

    uint64 nextEpoch = fork.lastEpoch + 1;
    Data.Epoch storage curEpoch = fork.epochs[nextEpoch];

    uint startBlockNumber = 1;

    if (nextEpoch != 1) {
      startBlockNumber = fork.epochs[fork.lastEpoch].endBlockNumber + 1;
    }

    curEpoch.initialized = true;
    curEpoch.timestamp = uint64(block.timestamp);

    curEpoch.startBlockNumber = uint64(startBlockNumber);
    curEpoch.endBlockNumber = uint64(startBlockNumber + NRELength - 1);

    emit EpochPrepared(
      currentFork,
      nextEpoch,
      curEpoch.startBlockNumber,
      curEpoch.endBlockNumber,
      0,
      0,
      false,
      false,
      false,
      curEpoch.rebase
    );
  }

  function prepareOREAfterURE() public payable {
    Data.Fork storage _f = forks[currentFork];
    bool isOREEmpty = _prepareOREAfterURE(_f, forks[currentFork.sub(1)], ORBs);
    uint64 epochNumber = _f.lastEpoch + 1;
    if (!isOREEmpty) {
      firstFilledORENumber[currentFork] = epochNumber;
    }

    emit EpochPrepared(
      currentFork,
      epochNumber,
      _f.epochs[epochNumber].startBlockNumber,
      _f.epochs[epochNumber].endBlockNumber,
      _f.epochs[epochNumber].requestStart,
      _f.epochs[epochNumber].requestEnd,
      isOREEmpty,
      true,
      false,
      true
    );

    if (isOREEmpty) {
      // set end block number of ORE' because it is 0. see EpochPrepared event.
      _f.epochs[epochNumber].endBlockNumber = _f.lastBlock;
      _f.lastEpoch = epochNumber;

      emit EpochRebased(
        currentFork,
        epochNumber,
        _f.epochs[epochNumber].startBlockNumber,
        _f.epochs[epochNumber].endBlockNumber,
        _f.epochs[epochNumber].requestStart,
        _f.epochs[epochNumber].requestEnd,
        true,
        true,
        false
      );

      prepareNREAfterURE();
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

      uint forkedEpochNumber = fork.getForkedEpoch();
      uint latestRequestEpochNumber = fork.epochs[fork.lastEpoch + 1].isRequest ?
        fork.lastEpoch + 1 :
        fork.lastEpoch;

      while (forkedEpochNumber > latestRequestEpochNumber) {
        forkNumber = forkNumber.sub(1);
        fork = forks[forkNumber];
        forkedEpochNumber = fork.getForkedEpoch();
        latestRequestEpochNumber = fork.epochs[fork.lastEpoch + 1].isRequest ?
        fork.lastEpoch + 1 :
        fork.lastEpoch;
      }

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

  function prepareNREAfterURE() public payable {
    Data.Fork storage _f = forks[currentFork];
    bool isNREEmpty = _prepareNREAfterURE(_f, forks[currentFork.sub(1)]);
    uint64 epochNumber = _f.lastEpoch + 1;

    emit EpochPrepared(
      currentFork,
      epochNumber,
      _f.epochs[epochNumber].startBlockNumber,
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
      _f.epochs[epochNumber].endBlockNumber = _f.lastBlock;
      _f.lastEpoch = epochNumber;
      _f.rebased = true;

      emit EpochRebased(
        currentFork,
        epochNumber,
        _f.epochs[epochNumber].startBlockNumber,
        _f.epochs[epochNumber].endBlockNumber,
        _f.epochs[epochNumber].requestStart,
        _f.epochs[epochNumber].requestEnd,
        true,
        false,
        false
      );
      _prepareToSubmitNRB();
    }
  }

  /**
   * @notice Prepare ORE'. return true if ORE' is empty
   */
  function _prepareOREAfterURE(
    Data.Fork storage _cur,
    Data.Fork storage _pre,
    Data.RequestBlock[] storage _rbs
  ) internal returns (bool isEmpty) {
    require(!_cur.rebased);

    Data.Epoch storage epoch = _cur.epochs[_cur.lastEpoch];

    // check preivous URE
    require(epoch.isRequest && epoch.userActivated);

    uint64 nextEpochNumber = _cur.lastEpoch + 1;

    uint forkedEpochNumber = _pre.blocks[_pre.forkedBlock].epochNumber;

    // prepare ORE' which covers all ORBs in previous fork but excludes exit requests.
    epoch = _cur.epochs[nextEpochNumber];

    epoch.initialized = true;
    epoch.isRequest = true;
    epoch.rebase = true;
    epoch.timestamp = uint64(block.timestamp);

    uint firstEpochNumber = _pre.epochs[forkedEpochNumber].isRequest ?
      forkedEpochNumber :
      forkedEpochNumber + 1;

   // find requestBlockId, start, end
    // uint lastEpochNumber = getLastEpochNumber(_pre, true);

    // // copy firstRequestBlockId from prefious fork even though the request block has no enter
    // epoch.firstRequestBlockId = _pre.epochs[lastEpochNumber].firstRequestBlockId;

    (epoch.firstRequestBlockId, epoch.requestStart, epoch.requestEnd) = _getLatestRequestInfo();

    // short circuit if there is no ORE at all.
    if (!_pre.epochs[firstEpochNumber].initialized) {
      epoch.isEmpty = true;
      epoch.startBlockNumber = _cur.lastBlock;
      epoch.endBlockNumber = _cur.lastBlock;
      return true;
    }

    assert(_pre.epochs[firstEpochNumber].isRequest);

    epoch.isEmpty = forkedEpochNumber > _pre.lastEnterEpoch;

    // short circut if the epoch is empty
    if (epoch.isEmpty) {
      // get ready to prepare NRE'
      epoch.startBlockNumber = _cur.lastBlock;
      epoch.endBlockNumber = _cur.lastBlock;
      return true;
    }

    // find next ORB to include into forked chain if ORE' is not empty
    uint firstEnterEpoch = firstEpochNumber;
    while (_pre.epochs[firstEpochNumber].numEnter == 0) {
      firstEnterEpoch += 2;
    }

    epoch.startBlockNumber = _cur.lastBlock.add64(1);

    uint preBlockNumber = _pre.epochs[firstEnterEpoch].startBlockNumber;

    Data.RequestBlock storage preRB = _rbs[_pre.blocks[preBlockNumber].requestBlockId];

    while (preRB.numEnter == 0) {
      preBlockNumber += 1;
      preRB = _rbs[_pre.blocks[preBlockNumber].requestBlockId];
    }

    _cur.nextBlockToRebase = uint64(preBlockNumber);

    return false;
  }

  /**
   * @notice Prepare NRE'. return true if NRE' is empty
   */
  function _prepareNREAfterURE(
    Data.Fork storage _cur,
    Data.Fork storage _pre
  ) internal returns (bool isEmpty) {
    require(!_cur.rebased);
    Data.Epoch storage epoch = _cur.epochs[_cur.lastEpoch];

    require(epoch.rebase && epoch.isRequest && !epoch.userActivated);

    // set end block number of ORE' because it is 0. see EpochPrepared event.
    _cur.epochs[_cur.lastEpoch].endBlockNumber = _cur.lastBlock;

    uint64 nextEpochNumber = _cur.lastEpoch + 1;

    uint forkedEpochNumber = _pre.blocks[_pre.forkedBlock].epochNumber;

    // prepare NRE'
    epoch = _cur.epochs[nextEpochNumber];

    epoch.initialized = true;
    epoch.rebase = true;
    epoch.timestamp = uint64(block.timestamp);

    uint previousNRENumber = !_pre.epochs[forkedEpochNumber].isRequest ?
      forkedEpochNumber :
      forkedEpochNumber + 1;

    // short circuit if there is no NRE to rebase at all.
    if (!_pre.epochs[previousNRENumber].initialized) {
      epoch.startBlockNumber = _cur.lastBlock;
      epoch.endBlockNumber = _cur.lastBlock;
      epoch.isEmpty = true;
      _cur.rebased = true;
      return true;
    }

    assert(!_pre.epochs[previousNRENumber].isRequest);

    epoch.startBlockNumber = _cur.lastBlock.add64(1);
    _cur.nextBlockToRebase = previousNRENumber == forkedEpochNumber ?
      _pre.forkedBlock :
      _pre.epochs[previousNRENumber].startBlockNumber;

    assert(_cur.nextBlockToRebase >= _pre.forkedBlock);
    return false;
  }
}