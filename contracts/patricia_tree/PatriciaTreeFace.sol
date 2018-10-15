pragma solidity ^0.4.24;
pragma experimental "v0.5.0";
pragma experimental "ABIEncoderV2";

import {PatriciaTreeData} from "./PatriciaTreeData.sol";


/*
 * Interface for patricia trees.
 *
 * More info at: https://github.com/chriseth/patricia-trie
 */
contract PatriciaTreeFace {
    function getRootHash() public view returns (bytes32 h);
    // function getRootEdge() public view returns (PatriciaTreeData.Edge e);
    function getRootEdge() public view returns (bytes32 node, bytes32 labelData, uint labelLength);
    // function getNode(bytes32 hash) public view returns (PatriciaTreeData.Node n);
    function getNode(bytes32 hash) public view returns (bytes32[2] nodes, bytes32[2] labelDatas, uint[2] labelLengths);
    function getProof(bytes key) public view returns (uint branchMask, bytes32[] _siblings);
    function verifyProof(bytes32 rootHash, bytes key, bytes value, uint branchMask, bytes32[] siblings) public view returns (bool success);
    function insert(bytes key, bytes value) public;
}
