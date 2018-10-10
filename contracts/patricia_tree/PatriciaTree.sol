pragma solidity ^0.4.24;
pragma experimental "v0.5.0";
pragma experimental "ABIEncoderV2";

import {PatriciaTreeData} from "./PatriciaTreeData.sol";
import {Bits} from "./Bits.sol";
import {PatriciaTreeFace} from "./PatriciaTreeFace.sol";


/*
 * Patricia tree implementation.
 *
 * More info at: https://github.com/chriseth/patricia-trie
 */
contract PatriciaTree is PatriciaTreeFace {

    using PatriciaTreeData for PatriciaTreeData.Tree;
    using PatriciaTreeData for PatriciaTreeData.Node;
    using PatriciaTreeData for PatriciaTreeData.Edge;
    using PatriciaTreeData for PatriciaTreeData.Label;
    using Bits for uint;

    PatriciaTreeData.Tree internal tree;

    // Get the root hash.
    function getRootHash() public view returns (bytes32) {
        return tree.root;
    }

    // Get the root edge.
    function getRootEdge() public view returns (PatriciaTreeData.Edge e) {
        e = tree.rootEdge;
    }

    // Get the node with the given key. The key needs to be
    // the keccak256 hash of the actual key.
    function getNode(bytes32 hash) public view returns (PatriciaTreeData.Node n) {
        n = tree.nodes[hash];
    }

    // Returns the Merkle-proof for the given key
    // Proof format should be:
    //  - uint branchMask - bitmask with high bits at the positions in the key
    //                    where we have branch nodes (bit in key denotes direction)
    //  - bytes32[] _siblings - hashes of sibling edges
    function getProof(bytes key) public view returns (uint branchMask, bytes32[] _siblings) {
        require(tree.root != 0);
        PatriciaTreeData.Label memory k = PatriciaTreeData.Label(keccak256(key), 256);
        PatriciaTreeData.Edge memory e = tree.rootEdge;
        bytes32[256] memory siblings;
        uint length;
        uint numSiblings;

        PatriciaTreeData.Label memory prefix;
        PatriciaTreeData.Label memory suffix;

        uint head;
        PatriciaTreeData.Label memory tail;

        while (true) {
            (prefix, suffix) = k.splitCommonPrefix(e.label);
            assert(prefix.length == e.label.length);
            if (suffix.length == 0) {
                // Found it
                break;
            }
            length += prefix.length;
            branchMask |= uint(1) << 255 - length;
            length += 1;
            (head, tail) = suffix.chopFirstBit();
            siblings[numSiblings++] = tree.nodes[e.node].children[1 - head].edgeHash();
            e = tree.nodes[e.node].children[head];
            k = tail;
        }
        if (numSiblings > 0) {
            _siblings = new bytes32[](numSiblings);
            for (uint i = 0; i < numSiblings; i++) {
                _siblings[i] = siblings[i];
            }
        }
    }

    function verifyProof(bytes32 rootHash, bytes key, bytes value, uint branchMask, bytes32[] siblings) public view returns (bool) {
        PatriciaTreeData.Label memory k = PatriciaTreeData.Label(keccak256(key), 256);
        PatriciaTreeData.Edge memory e;
        e.node = keccak256(value);
        for (uint i = 0; branchMask != 0; i++) {
            uint bitSet = branchMask.lowestBitSet();
            branchMask &= ~(uint(1) << bitSet);
            (k, e.label) = k.splitAt(255 - bitSet);
            uint bit;
            (bit, e.label) = e.label.chopFirstBit();
            bytes32[2] memory edgeHashes;
            edgeHashes[bit] = e.edgeHash();
            edgeHashes[1 - bit] = siblings[siblings.length - i - 1];
            // e.node = keccak256(edgeHashes);
            // TODO: check result
            e.node = keccak256(abi.encodePacked(edgeHashes[0], edgeHashes[1]));
        }
        e.label = k;
        require(rootHash == e.edgeHash());
        return true;
    }

    function insert(bytes key, bytes value) public {
        tree.insert(key, value);
    }

}
