pragma solidity ^0.5.12;

import "./lib/SafeMath.sol";
import "./lib/Ownable.sol";
import "./RequestableI.sol";


contract RequestableSimpleToken is Ownable, RequestableI {
  using SafeMath for *;

  // `owner` is stored at bytes32(0).
  // address owner; from Ownable

  // `totalSupply` is stored at bytes32(1).
  uint public totalSupply;

  // `balances[addr]` is stored at keccak256(bytes32(addr), bytes32(2)).
  mapping(address => uint) public balances;

  // requests
  mapping(uint => bool) appliedRequests;

  bytes32 constant public KEY_OWNER         = 0x0000000000000000000000000000000000000000000000000000000000000000;
  bytes32 constant public KEY_TOTAL_SUPPLY  = 0x0000000000000000000000000000000000000000000000000000000000000001;
  bytes32 constant public PERFIX_BALANCES   = 0x0000000000000000000000000000000000000000000000000000000000000002;

  /* Events */
  event Transfer(address _from, address _to, uint _value);
  event Mint(address _to, uint _value);
  event Requested(bool _isExit, address _requestor, bytes32 _trieKey, bytes _trieValue);

  function transfer(address _to, uint _value) public {
    balances[msg.sender] = balances[msg.sender].sub(_value);
    balances[_to] = balances[_to].add(_value);

    emit Transfer(msg.sender, _to, _value);
  }

  function mint(address _to, uint _value) public onlyOwner {
    totalSupply = totalSupply.add(_value);
    balances[_to] = balances[_to].add(_value);

    emit Mint(_to, _value);
    emit Transfer(address(0), _to, _value);
  }

  // User can get the trie key of one's balance and make an enter request directly.
  function getBalanceTrieKey(address who) public pure returns (bytes32) {
    return keccak256(abi.encodePacked(bytes32(bytes20(who)), PERFIX_BALANCES));
  }

  function applyRequestInRootChain(
    bool isExit,
    uint256 requestId,
    address requestor,
    bytes32 trieKey,
    bytes calldata trieValue
  ) external returns (bool success) {
    // TODO: adpot RootChain
    // require(msg.sender == address(rootchain));

    require(!appliedRequests[requestId]);

    if (isExit) {
      if (KEY_OWNER == trieKey) {
        // only owner (in child chain) can exit `owner` variable.
        // but it is checked in applyRequestInChildChain and exitChallenge.

        // set requestor as owner in root chain.
        _transferOwnership(requestor);
      } else if (KEY_TOTAL_SUPPLY == trieKey) {
        // no one can exit `totalSupply` variable.
        // but do nothing to return true.
      } else if (getBalanceTrieKey(requestor) == trieKey) {
        // this checks trie key equals to `balances[requestor]`.
        // only token holder can exit one's token.
        // exiting means moving tokens from child chain to root chain.
        balances[requestor] += decodeTrieValue(trieValue);
      } else {
        // cannot exit other variables.
        // but do nothing to return true.
      }
    } else {
      // apply enter
      if (KEY_OWNER == trieKey) {
        // only owner (in root chain) can enter `owner` variable.
        require(owner() == requestor);
        // do nothing in root chain
      } else if (KEY_TOTAL_SUPPLY == trieKey) {
        // no one can enter `totalSupply` variable.
        revert();
      } else if (getBalanceTrieKey(requestor) == trieKey) {
        // this checks trie key equals to `balances[requestor]`.
        // only token holder can enter one's token.
        // entering means moving tokens from root chain to child chain.
        require(balances[requestor] >= decodeTrieValue(trieValue));
        balances[requestor] -= decodeTrieValue(trieValue);
      } else {
        // cannot apply request on other variables.
        revert();
      }
    }

    appliedRequests[requestId] = true;

    emit Requested(isExit, requestor, trieKey, trieValue);

    // TODO: adpot RootChain
    // setRequestApplied(requestId);
    return true;
  }

  // this is only called by NULL_ADDRESS in child chain
  // when i) exitRequest is initialized by startExit() or
  //     ii) enterRequest is initialized
  function applyRequestInChildChain(
    bool isExit,
    uint256 requestId,
    address requestor,
    bytes32 trieKey,
    bytes calldata trieValue
  ) external returns (bool success) {
    // TODO: adpot child chain
    // require(msg.sender == NULL_ADDRESS);
    require(!appliedRequests[requestId]);

    if (isExit) {
      if (KEY_OWNER == trieKey) {
        // only owner (in child chain) can exit `owner` variable.
        require(owner() == requestor);

        // do nothing when exit `owner` in child chain
      } else if (KEY_TOTAL_SUPPLY == trieKey) {
        // no one can exit `totalSupply` variable.
        revert();
      } else if (getBalanceTrieKey(requestor) == trieKey) {
        // this checks trie key equals to `balances[tokenHolder]`.
        // only token holder can exit one's token.
        // exiting means moving tokens from child chain to root chain.

        // revert provides a proof for `exitChallenge`.
        require(balances[requestor] >= decodeTrieValue(trieValue));

        balances[requestor] -= decodeTrieValue(trieValue);
      } else { // cannot exit other variables.
        revert();
      }
    } else { // apply enter
      if (KEY_OWNER == trieKey) {
        // only owner (in root chain) can make enterRequest of `owner` variable.
        // but it is checked in applyRequestInRootChain.

        _transferOwnership(requestor);
      } else if (KEY_TOTAL_SUPPLY == trieKey) {
        // no one can enter `totalSupply` variable.
      } else if (getBalanceTrieKey(requestor) == trieKey) {
        // this checks trie key equals to `balances[tokenHolder]`.
        // only token holder can enter one's token.
        // entering means moving tokens from root chain to child chain.
        balances[requestor] += decodeTrieValue(trieValue);
      } else {
        // cannot apply request on other variables.
        revert();
      }
    }

    appliedRequests[requestId] = true;

    emit Requested(isExit, requestor, trieKey, trieValue);
    return true;
  }

  function decodeTrieValue(bytes memory trieValue) public pure returns (uint v) {
    require(trieValue.length == 0x20);

    assembly {
       v := mload(add(trieValue, 0x20))
    }
  }
}
