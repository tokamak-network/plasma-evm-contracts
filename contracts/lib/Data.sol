pragma solidity ^0.5.12;


import "./SafeMath.sol";
import "./Math.sol";
import "./RLP.sol";
import "./RLPEncode.sol";
import "./BMT.sol";

// import "../patricia_tree/PatriciaTree.sol"; // use binary merkle tree
import {RequestableI} from "../RequestableI.sol";


library Data {
  using SafeMath for uint;
  using SafeMath for uint64;
  using Math for *;
  using RLP for *;
  using RLPEncode for *;
  using BMT for *;

  // solium-disable max-len
  bytes4 public constant APPLY_IN_CHILDCHAIN_SIGNATURE = bytes4(keccak256("applyRequestInChildChain(bool,uint256,address,bytes32,bytes)"));
  bytes4 public constant APPLY_IN_ROOTCHAIN_SIGNATURE = bytes4(keccak256("applyRequestInRootChain(bool,uint256,address,bytes32,bytes)"));
  // solium-enable max-len

  address public constant NA = address(0);
  uint public constant NA_TX_GAS_PRICE = 1e9;
  uint public constant NA_TX_GAS_LIMIT = 100000;

  // How many requests can be included in a single request block
  function MAX_REQUESTS() internal pure returns (uint) {
    // TODO: use 100 in production mode
    // return 1000;
    return 20;
  }

  // Timeout for URB submission
  function URE_TIMEOUT() internal pure returns (uint) {
    return 1 hours;
  }

  function decodePos(uint _pos) internal pure returns (uint v1, uint v2) {
    assembly {
      v1 := div(_pos, exp(2, 128))
      v2 := and(_pos, sub(exp(2, 128), 1))
    }
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
   * firstEnterEpoch            epoch number of first enter request epoch
   * lastEnterEpoch             epoch number of last enter request epoch
   * nextBlockToRebase
   * rebased                    true if all blocks are rebased
   * epochs                     epochs in this fork
   * blocks                     blocks in this fork
   */
  struct Fork {
    // uint64 blockToRenew;
    uint64 forkedBlock; // TODO: change to forkedEpoch
    uint64 firstEpoch;
    uint64 lastEpoch;
    uint64 firstBlock;
    uint64 lastBlock;
    uint64 lastFinalizedEpoch;
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

    if (_isRequest) {
      b.requestBlockId = uint64(epoch.RE.firstRequestBlockId + blockNumber - epoch.startBlockNumber);
    }

    _f.lastBlock = uint64(blockNumber);
    return (epochNumber, blockNumber);
  }


  /**
   * TODO: implement insert rebased non-request epoch
   * @notice Insert non-request epoch into the fork.
   */
  function insertNRE(
    Fork storage _f,
    uint _epochNumber,
    bytes32 _epochStateRoot,
    bytes32 _epochTransactionsRoot,
    bytes32 _epochReceiptsRoot,
    uint _startBlockNumber,
    uint _endBlockNumber
  )
    internal
  {
    require(_f.lastEpoch.add(1) == _epochNumber);
    require(_f.lastBlock.add(1) == _startBlockNumber);

    Data.Epoch storage epoch = _f.epochs[_epochNumber];

    require(!epoch.isRequest);
    require(!epoch.userActivated);
    require(!epoch.rebase);

    require(epoch.startBlockNumber == _startBlockNumber);
    require(epoch.endBlockNumber == _endBlockNumber);

    epoch.NRE.epochStateRoot = _epochStateRoot;
    epoch.NRE.epochTransactionsRoot = _epochTransactionsRoot;
    epoch.NRE.epochReceiptsRoot = _epochReceiptsRoot;
    epoch.NRE.submittedAt = uint64(block.timestamp);

    _f.lastEpoch = uint64(_epochNumber);
    _f.lastBlock = uint64(_endBlockNumber);
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
      while (_pre.epochs[epochNumber].RE.numEnter == 0 && _pre.epochs[epochNumber].initialized) {
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
   * startBlockNumber       first block number of the epoch.
   * endBlockNumber         last block number of the epoch. 0 if the epoch is ORE' / NRE' until ORE' is filled.
   * timestamp              timestamp when the epoch is initialized.
   *                        required for URB / ORB
   * epochStateRoot         merkle root of [block.stateRoot] for block in the epoch.
   * epochTransactionsRoot  merkle root of [block.transactionsRoot] for block in the epoch.
   * epochReceiptsRoot      merkle root of [block.receiptsRoot] for block in the epoch.
   * isEmpty                true if request epoch has no request block
   *                        also and requestStart == requestEnd == previousEpoch.RE.requestEnd
   *                        and startBlockNumber == endBlockNumber == previousEpoch.endBlockNumber
   *                        and firstRequestBlockId == previousEpoch.firstRequestBlockId
   * initialized            true if epoch is initialized
   * isRequest              true in case of URB / ORB
   * userActivated          true in case of URB
   * rebase                 true in case of ORE' or NRE'
   */
  struct Epoch {
    uint64 startBlockNumber;
    uint64 endBlockNumber;
    uint64 timestamp;
    bool isEmpty;
    bool initialized;
    bool isRequest;
    bool userActivated;
    bool rebase;
    RequestEpochMeta RE;
    NonRequestEpochMeta NRE;
  }

  struct NonRequestEpochMeta {
    bytes32 epochStateRoot;
    bytes32 epochTransactionsRoot;
    bytes32 epochReceiptsRoot;
    uint64 submittedAt;
    uint64 finalizedAt;
    bool finalized;
    bool challenging;
    bool challenged;
  }

  /**
   * requestStart           first request id.
   * requestEnd             last request id.
   * firstRequestBlockId    first id of RequestBlock[]
   *                        if epochs is ORE', copy from last request epoch in previous fork
   * numEnter               number of enter request
   * nextEnterEpoch         next request epoch including enter request
   * nextEpoch              next non-empty request epoch
   */
  struct RequestEpochMeta {
    uint64 requestStart;
    uint64 requestEnd;
    uint64 firstRequestBlockId;
    uint64 numEnter;
    uint64 nextEnterEpoch;
    uint64 nextEpoch;
  }

  // function noExit(Epoch storage self) internal returns (bool) {
  //   if (self.rebase) return true;
  //   return self.RE.requestEnd.sub64(self.RE.requestStart).add64(1) == self.RE.firstRequestBlockId;
  // }

  function getNumBlocks(Epoch storage _e) internal view returns (uint) {
    if (_e.isEmpty || _e.rebase && _e.endBlockNumber == 0) return 0;
    return _e.endBlockNumber + 1 - _e.startBlockNumber;
  }

  function getNumRequests(Epoch storage _e) internal view returns (uint) {
    if (_e.isEmpty || _e.rebase && _e.endBlockNumber == 0) return 0;
    return _e.RE.requestEnd + 1 - _e.RE.requestStart;
  }

  function calcNumBlock(uint _rs, uint _re) internal pure returns (uint) {
    return _re.sub(_rs).add(1).divCeil(MAX_REQUESTS());
  }

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
    address payable requestor;
    address to;
    bytes32 trieKey;
    bytes32 hash;
    bytes trieValue;
  }

  function applyRequestInRootChain(
    Request memory self,
    uint _requestId
  )
    internal
    returns (bool)
  {
    require(gasleft() > NA_TX_GAS_LIMIT + 5000);

    return RequestableI(self.to).applyRequestInRootChain(
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

    // Enter request of EtherToken mints PETH to requestor.
    if (!self.isExit && self.isTransfer) {
      out.to = self.requestor;
      bytes memory b = self.trieValue;
      uint128 v;

      assembly {
        v := mload(add(b, 0x20))
      }

      require(v > 0);

      // no trieKey and trieValue for EtherToken enter
      out.value = uint128(v);
    } else {
      out.to = _to;
      out.value = self.value;
      out.trieKey = self.trieKey;
      out.trieValue = self.trieValue;
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
    if (self.isTransfer && !self.isExit) {
      return out;
    }

    bytes4 funcSig = _rootchain ? APPLY_IN_ROOTCHAIN_SIGNATURE : APPLY_IN_CHILDCHAIN_SIGNATURE;

    out = abi.encodePacked(
      funcSig,
      abi.encode(
        bytes32(uint(self.isExit ? 1 : 0)),
        _requestId,
        uint256(uint160(self.requestor)),
        self.trieKey,
        self.trieValue
      )
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
  //   return self.RE.requestEnd.sub64(self.RE.requestStart).add64(1) == self.RE.firstRequestBlockId;
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

    uint txIndex = _requestId.sub(self.RE.requestStart);

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
