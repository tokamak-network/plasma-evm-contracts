pragma solidity ^0.4.24;
pragma experimental ABIEncoderV2;

import "./SafeMath.sol";
import "./Math.sol";
import "./RLP.sol";
import "./RLPEncode.sol";
import "./BMT.sol";

// import "../patricia_tree/PatriciaTree.sol"; // use binary merkle tree
import {RequestableContractI} from "../RequestableContractI.sol";


library Data {
  using SafeMath for uint;
  using SafeMath for uint64;
  using Math for *;
  using RLP for *;
  using RLPEncode for *;
  using BMT for *;

  // signature of function applyRequestInChildChain(bool,uint256,address,bytes32,bytes32)
  bytes4 public constant APPLY_IN_CHILDCHAIN_SIGNATURE = 0xe904e3d9;

  // signature of function applyRequestInRootChain(bool,uint256,address,bytes32,bytes32)
  bytes4 public constant APPLY_IN_ROOTCHAIN_SIGNATURE = 0xd9afd3a9;

  address public constant NA = address(0);
  uint public constant NA_TX_GAS_PRICE = 1e9;
  uint public constant NA_TX_GAS_LIMIT = 100000;

  // How many requests can be included in a single request block
  function MAX_REQUESTS() internal pure returns (uint) {
    return 1000;
  }

  // Timeout for URB submission
  function URE_TIMEOUT() internal pure returns (uint) {
    return 1 hours;
  }

  /**
   * highestFinalizedBlock
   * firstEpochNumber
   * blockToRenew               0 means no renew required
   * forkedBlock                forked block number due to URB submission
   *                            last finalized block is forkedBlockNumber - 1
   * urbEpochNumber
   * lastEpoch
   * lastBlock
   * lastFinalizedBlock
   * timestamp
   * nextBlockToRebase
   * rebased                    true if all blocks are rebased
   * epochs                     epochs in this fork
   * blocks                     blocks in this fork
   */
  struct Fork {
    // uint64 blockToRenew;
    uint64 forkedBlock;
    uint64 firstEpoch;
    uint64 lastEpoch;
    uint64 firstBlock;
    uint64 lastBlock;
    uint64 lastFinalizedBlock;
    uint64 timestamp;
    uint64 firstEnterEpoch;
    uint64 lastEnterEpoch;
    uint64 nextBlockToRebase;
    bool rebased;
    mapping (uint => Epoch) epochs;
    mapping (uint => PlasmaBlock) blocks;
  }

  function getForkedEpoch(Fork storage self) internal view returns (uint64) {
    require(self.forkedBlock != 0);
    return self.blocks[self.forkedBlock].epochNumber;
  }



  /**
   * @notice Insert a block (ORB / NRB) into the fork.
   */
  function insertBlock(
    Fork storage _f,
    bytes32 _statesRoot,
    bytes32 _transactionsRoot,
    bytes32 _receiptsRoot,
    bool _isRequest,
    bool _userActivated,
    bool _rebase
  )
    internal
    returns (uint epochNumber, uint blockNumber)
  {
    epochNumber = _f.lastEpoch;
    blockNumber = _f.lastBlock.add(1);

    Data.Epoch storage epoch = _f.epochs[epochNumber];

    if (blockNumber == epoch.endBlockNumber + 1) {
      epochNumber += 1;
      _f.lastEpoch = uint64(epochNumber);
      epoch = _f.epochs[epochNumber];
    }

    require(epoch.startBlockNumber <= blockNumber);
    require(_rebase || epoch.endBlockNumber >= blockNumber);

    require(epoch.isRequest == _isRequest);
    require(epoch.userActivated == _userActivated);

    Data.PlasmaBlock storage b = _f.blocks[blockNumber];

    b.epochNumber = uint64(epochNumber);
    b.statesRoot = _statesRoot;
    b.transactionsRoot = _transactionsRoot;
    b.receiptsRoot = _receiptsRoot;
    b.timestamp = uint64(block.timestamp);
    b.isRequest = _isRequest;
    b.userActivated = _userActivated;

    _f.lastBlock = uint64(blockNumber);
    return;
  }

  function getLastEpochNumber(Fork storage _f, bool _isRequest) internal returns (uint) {
    if (_f.epochs[_f.lastEpoch].isRequest == _isRequest) {
      return _f.lastEpoch;
    }

    return _f.lastEpoch - 1;
  }

  // function getFirstNotFinalizedEpochNumber(Fork storage _f, bool _isRequest) internal returns (uint) {
  //   if (_f.epochs[_f.lastEpoch].isRequest == _isRequest) {
  //     return _f.lastEpoch;
  //   }

  //   return _f.lastEpoch - 1;
  // }

  /**
   * @notice Update nextBlockToRebase to next request block containing enter request.
   *         If all ORBs are rebased, return true.
   */
  function checkNextORBToRebase(
    Fork storage _cur,
    Fork storage _pre,
    RequestBlock[] storage _rbs
  ) internal returns (bool finished) {
    uint blockNumber = _cur.nextBlockToRebase;
    uint epochNumber = _pre.blocks[_cur.nextBlockToRebase].epochNumber;
    // uint lastEpochNumber = getLastEpochNumber(_pre, true);

    while (_pre.epochs[epochNumber].initialized) {
      // at the end of epoch
      if (_pre.epochs[epochNumber].endBlockNumber <= blockNumber) {
        epochNumber += 2;
        blockNumber = _pre.epochs[epochNumber].startBlockNumber;
      }

      // skip until epoch has enter request
      while (_pre.epochs[epochNumber].numEnter == 0 && _pre.epochs[epochNumber].initialized) {
        epochNumber += 2;
        blockNumber = _pre.epochs[epochNumber].startBlockNumber;
      }

      // short circuit if all OREs are empty or has no enter
      if (!_pre.epochs[epochNumber].initialized) {
        return true;
      }

      // skip blocks without enter request
      uint endBlockNumber = _pre.epochs[epochNumber].endBlockNumber;
      while (blockNumber <= endBlockNumber) {
        if (_rbs[_pre.blocks[blockNumber].requestBlockId].numEnter > 0) {
          break;
        }
        blockNumber += 1;
      }

      // continue if there is no block containing enter request
      if (blockNumber > endBlockNumber) {
        epochNumber += 2;
        blockNumber = _pre.epochs[epochNumber].startBlockNumber;
        continue;
      }

      // target block number is found
      _cur.nextBlockToRebase = uint64(blockNumber);
      return false;
    }

    // ready to prepare NRE
    return true;
  }

  /**
   * @notice Update nextBlockToRebase to next non request block
   *         If all NRBs are rebased, return true.
   * TODO    What if no ORE' ?
   */
  function checkNextNRBToRebase(
    Fork storage _cur,
    Fork storage _pre
  ) internal returns (bool finished) {
    uint blockNumber = _cur.nextBlockToRebase;
    uint epochNumber = _pre.blocks[blockNumber].epochNumber;

    // at the end of epoch
    if (_pre.epochs[epochNumber].endBlockNumber <= blockNumber) {
      epochNumber += 2;
      blockNumber = _pre.epochs[epochNumber].startBlockNumber;
    } else {
      blockNumber += 1;
    }

    // short circit if all NRE's are rebased
    if (!_pre.epochs[epochNumber].initialized) {
      _cur.nextBlockToRebase = 0;
      return true;
    }

    // short circuit if block is not submitted
    if (_pre.blocks[blockNumber].timestamp == 0) {
      _cur.nextBlockToRebase = 0;
      return true;
    }

    _cur.nextBlockToRebase = uint64(blockNumber);
    return false;
  }

  /**
   *
   * requestStart         first request id. 0 if the epoch is ORE'.
   * requestEnd           last request id. 0 if the epoch is ORE'.
   * startBlockNumber     first block number of the epoch.
   * endBlockNumber       last block number of the epoch. 0 if the epoch is ORE' / NRE' until ORE' is filled.
   * firstRequestBlockId  first id of RequestBlock[]
   *                      if epochs is ORE', copy from last request epoch in previous fork
   * timestamp            timestamp when the epoch is initialized.
   *                      required for URB / ORB
   * isEmpty              true if request epoch has no request block
   *                      also and requestStart == requestEnd == previousEpoch.requestEnd
   *                      and startBlockNumber == endBlockNumber == previousEpoch.endBlockNumber
   *                      and firstRequestBlockId == previousEpoch.firstRequestBlockId
   * initialized          true if epoch is initialized
   * isRequest            true in case of URB / ORB
   * userActivated        true in case of URB
   * rebase               true in case of ORE' or NRE'
   */
  struct Epoch {
    uint64 requestStart;
    uint64 requestEnd;
    uint64 startBlockNumber;
    uint64 endBlockNumber;
    uint64 firstRequestBlockId;
    uint64 numEnter;
    uint64 nextEnterEpoch;
    uint64 timestamp;
    bool isEmpty;
    bool initialized;
    bool isRequest;
    bool userActivated;
    bool rebase;
  }

  // function noExit(Epoch storage self) internal returns (bool) {
  //   if (self.rebase) return true;
  //   return self.requestEnd.sub64(self.requestStart).add64(1) == self.numEnter;
  // }

  function getNumBlocks(Epoch storage _e) internal view returns (uint) {
    if (_e.isEmpty || _e.rebase && _e.endBlockNumber == 0) return 0;
    return _e.endBlockNumber + 1 - _e.startBlockNumber;
  }

  function getNumRequests(Epoch storage _e) internal view returns (uint) {
    if (_e.isEmpty || _e.rebase && _e.endBlockNumber == 0) return 0;
    return _e.requestEnd + 1 - _e.requestStart;
  }

  /**
   * @notice This returns the request block number if the request is included
   *         in an epoch. Otherwise, returns 0.
   */
  // function getBlockNumber(Epoch memory _e, uint _requestId) internal pure returns (uint) {
  //   if (!_e.isRequest ||
  //     _e.isEmpty ||
  //     _e.requestStart < _requestId ||
  //     _e.requestEnd > _requestId) {
  //     return 0;
  //   }

  //   return uint(_e.startBlockNumber)
  //     .add(uint(_requestId - _e.requestStart + 1).divCeil(MAX_REQUESTS()));
  // }

  function calcNumBlock(uint _rs, uint _re) internal pure returns (uint) {
    return _re.sub(_rs).add(1).divCeil(MAX_REQUESTS());
  }

  // function getRequestRange(Epoch memory _e, uint _blockNumber, uint _limit)
  //   internal
  //   pure
  //   returns (uint requestStart, uint requestEnd)
  // {
  //   require(_e.isRequest);
  //   require(_blockNumber >= _e.startBlockNumber && _blockNumber <= _e.endBlockNumber);

  //   if (_blockNumber == _e.endBlockNumber) {
  //     requestStart = _e.requestStart + (getNumBlocks(_e) - 1) * _limit;
  //     requestEnd = _e.requestEnd;
  //     return;
  //   }

  //   requestStart = _e.requestStart + (_blockNumber - _e.startBlockNumber) * _limit;
  //   requestEnd = requestStart + _limit;
  //   return;
  // }

  /**
   * epochNumber
   * requestBlockId       id of RequestBlock[]
   * timestamp
   * referenceBlock       block number in previous fork
   * statesRoot
   * transactionsRoot
   * receiptsRoot
   * isRequest            true in case of URB & OR
   * userActivated        true in case of URB
   * challenged           true if it is challenge
   * challenging          true if it is being challenged
   * finalized            true if it is successfully finalize
   */
  struct PlasmaBlock {
    uint64 epochNumber;
    uint64 requestBlockId;
    uint64 timestamp;
    uint64 finalizedAt;
    uint64 referenceBlock;
    bytes32 statesRoot;
    bytes32 transactionsRoot;
    bytes32 receiptsRoot;
    bool isRequest;
    bool userActivated;
    bool challenged;
    bool challenging;
    bool finalized;
  }

  /**
   *
   * timestamp
   * isExit
   * isTransfer
   * finalized         true if request is finalized
   * challenged
   * value             ether amount in wei
   * requestor
   * to                requestable contract in root chain
   * trieKey
   * trieValue
   * hash              keccak256 hash of request transaction (in plasma chain)
   */
  struct Request {
    uint64 timestamp;
    bool isExit;
    bool isTransfer;
    bool finalized;
    bool challenged;
    uint128 value;
    address requestor;
    address to;
    bytes32 trieKey;
    bytes32 trieValue;
    bytes32 hash;
  }

  function applyRequestInRootChain(
    Request memory self,
    uint _requestId
  )
    internal
    returns (bool)
  {
    // TODO: ignore transfer or applyRequestInRootChain?

    if (self.isTransfer) {
      self.to.transfer(self.value);
      return true;
    }

    return RequestableContractI(self.to).applyRequestInRootChain(
      self.isExit,
      _requestId,
      self.requestor,
      self.trieKey,
      self.trieValue
    );
  }

  function toChildChainRequest(
    Request memory self,
    address _to
  )
    internal
    pure
    returns (Request memory out)
  {
    out.isExit = self.isExit;
    out.isTransfer = self.isTransfer;
    out.requestor = self.requestor;
    out.value = self.value;
    out.trieKey = self.trieKey;
    out.trieValue = self.trieValue;

    if (out.isTransfer) {
      out.to = self.to;
    } else {
      out.to = _to;
    }
  }

  /**
   * @notice return tx.data
   */
  function getData(
    Request memory self,
    uint _requestId,
    bool _rootchain
  )
    internal
    pure
    returns (bytes memory out)
  {
    if (self.isTransfer) {
      return;
    }

    bytes4 funcSig = _rootchain ? APPLY_IN_ROOTCHAIN_SIGNATURE : APPLY_IN_CHILDCHAIN_SIGNATURE;

    out = abi.encodePacked(
      funcSig,
      bytes32(uint(self.isExit ? 1 : 0)),
      _requestId,
      bytes32(self.requestor),
      self.trieKey,
      self.trieValue
    );
  }

  /**
   * @notice convert Request to TX
   */
  function toTX(
    Request memory self,
    uint _requestId,
    bool _rootchain
  )
    internal
    pure
    returns (TX memory out)
  {
    out.gasPrice = NA_TX_GAS_PRICE;
    out.gasLimit = uint64(NA_TX_GAS_LIMIT);
    out.to = self.to;
    out.value = self.value;
    out.data = getData(self, _requestId, _rootchain);
  }

  /**
   * submitted      true if no more request can be inserted
   *                because epoch is initialized
   * epochNumber    non request epoch number where the request is created
   * requestStart   first request id
   * requestEnd     last request id
   * trie           patricia tree contract address
   */
  struct RequestBlock {
    bool submitted;
    uint64 numEnter;
    uint64 epochNumber;
    uint64 requestStart;
    uint64 requestEnd;
    address trie;
  }

  // function noExit(RequestBlock storage self) internal returns (bool) {
  //   return self.requestEnd.sub64(self.requestStart).add64(1) == self.numEnter;
  // }

  function init(RequestBlock storage self) internal {
    /* use binary merkle tree instead of patricia tree
    if (self.trie == address(0)) {
      self.trie = new PatriciaTree();
    }
     */
  }

  function addRequest(
    RequestBlock storage self,
    Request storage _rootchainRequest,  // request in root chain
    Request memory _childchainRequest,  // request in child chain
    uint _requestId
  ) internal {
    _rootchainRequest.hash = hash(toTX(_childchainRequest, _requestId, false));

    /* use binary merkle tree instead of patricia tree
    require(self.trie != address(0));

    uint txIndex = _requestId.sub(self.requestStart);

    bytes memory key = txIndex.encodeUint();
    bytes memory value = toBytes(toTX(_request, _requestId, false));

    PatriciaTree(self.trie).insert(key, value);
    self.transactionsRoot = PatriciaTree(self.trie).getRootHash();
     */
  }

  /*
   * TX for Ethereum transaction
   */
  struct TX {
    uint64 nonce;
    uint256 gasPrice;
    uint64 gasLimit;
    address to;
    uint256 value;
    bytes data;
    uint256 v;
    uint256 r;
    uint256 s;
  }

  function isNATX(TX memory self) internal pure returns (bool) {
    return self.v == 0 && self.r == 0 && self.s == 0;
  }

  // function toTX(bytes memory self) internal pure returns (TX memory out) {
  //   RLP.RLPItem[] memory packArr = self.toRLPItem().toList(9);

  //   out.nonce = uint64(packArr[0].toUint());
  //   out.gasPrice = packArr[1].toUint();
  //   out.gasLimit = uint64(packArr[2].toUint());
  //   out.to = packArr[3].toAddress();
  //   out.value = packArr[4].toUint();
  //   out.data = packArr[5].toBytes();
  //   out.v = packArr[6].toUint();
  //   out.r = packArr[7].toUint();
  //   out.s = packArr[8].toUint();
  // }

  /**
   * @notice Convert TX to RLP-encoded bytes
   */
  function toBytes(TX memory self) internal pure returns (bytes memory out) {
    bytes[] memory packArr = new bytes[](9);

    packArr[0] = self.nonce.encodeUint();
    packArr[1] = self.gasPrice.encodeUint();
    packArr[2] = self.gasLimit.encodeUint();
    packArr[3] = self.to.encodeAddress();
    packArr[4] = self.value.encodeUint();
    packArr[5] = self.data.encodeBytes();
    packArr[6] = self.v.encodeUint();
    packArr[7] = self.r.encodeUint();
    packArr[8] = self.s.encodeUint();

    return packArr.encodeList();
  }

  // function toTX(
  //   uint64 _nonce,
  //   uint256 _gasPrice,
  //   uint64 _gasLimit,
  //   address _to,
  //   uint256 _value,
  //   bytes _data,
  //   uint256 _v,
  //   uint256 _r,
  //   uint256 _s
  // )
  //   internal
  //   pure
  //   returns (TX memory out)
  // {
  //   out.nonce = _nonce;
  //   out.gasPrice = _gasPrice;
  //   out.gasLimit = _gasLimit;
  //   out.to = _to;
  //   out.value = _value;
  //   out.data = _data;
  //   out.v = _v;
  //   out.r = _r;
  //   out.s = _s;
  // }

  function hash(TX memory self) internal pure returns (bytes32) {
    bytes memory txBytes = toBytes(self);
    return keccak256(txBytes);
  }

  /**
   * Transaction Receipt
   */

  struct Log {
    address contractAddress;
    bytes32[] topics;
    bytes data;
  }

  struct Receipt {
    uint64 status;
    uint64 cumulativeGasUsed;
    bytes bloom; // 2048 bloom bits, byte[256]
    Log[] logs;
  }

  function toReceipt(bytes memory self) internal pure returns (Receipt memory r) {
    RLP.RLPItem[] memory items = self.toRLPItem().toList(4);

    r.status = uint64(items[0].toUint());
    r.cumulativeGasUsed = uint64(items[1].toUint());
    r.bloom = items[2].toBytes();

    // TODO: parse Logs
    r.logs = new Log[](0);
  }

  function toReceiptStatus(bytes memory self) internal pure returns (uint) {
    RLP.RLPItem[] memory items = self.toRLPItem().toList(4);
    return items[0].toUint();
  }


  /**
   * Helpers
   */

  /**
   * @notice Checks transaction root of a request block
   */
  function _checkTxRoot(
    bytes32 _transactionsRoot,
    RequestBlock storage _rb,
    Request[] storage _rs,
    bool _skipExit
  ) internal {
    uint s = _rb.requestStart;
    uint e = _rb.requestEnd;
    uint n = _skipExit ? _rb.numEnter : e - s + 1;

    require(n > 0);

    bytes32[] memory hashes = new bytes32[](n);

    // TODO: optimize to reduce gas
    uint j = s;
    for (uint i = s; i <= e; i++) {
      if (!_skipExit || !_rs[i].isExit) {
        hashes[j - s] = _rs[i].hash;
        j++;
      }
    }

    require(hashes.getRoot() == _transactionsRoot);

    /* use binary merkle tree instead of patricia tree
    Data.RequestBlock storage ORB = ORBs[fork.blocks[blockNumber].requestBlockId];
    require(_transactionsRoot == ORB.transactionsRoot);
      */
  }
}
