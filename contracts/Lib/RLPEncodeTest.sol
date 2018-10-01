pragma solidity ^0.4.24;
pragma experimental ABIEncoderV2;

/**
 * @title A simple RLP encoding library
 * @author Bakaoh
 */
contract RLPEncodeTest {

    uint8 constant STRING_OFFSET = 0x80;
    uint8 constant LIST_OFFSET = 0xc0;

    bytes[] tx_list;
    /**
     * @notice Encode string item
     * @param self The string (ie. byte array) item to encode
     * @return The RLP encoded string in bytes
     */
    function encodeBytes(bytes memory self) public pure returns (bytes) {
        if (self.length == 1 && self[0] <= 0x7f) {
            return self;
        }
        return mergeBytes(encodeLength(self.length, STRING_OFFSET), self);
    }

    /**
     * @notice Encode address
     * @param self The address to encode
     * @return The RLP encoded address in bytes
     */
    function encodeAddress(address self) public pure returns (bytes) {
        bytes memory b;
        assembly {
            let m := mload(0x40)
            mstore(add(m, 20), xor(0x140000000000000000000000000000000000000000, self))
            mstore(0x40, add(m, 52))
            b := m
        }
        return encodeBytes(b);
    }

    /**
     * @notice Encode uint
     * @param self The uint to encode
     * @return The RLP encoded uint in bytes
     */
    function encodeUint(uint self) public pure returns (bytes) {
        return encodeBytes(toBinary(self));
    }

    /**
     * @notice Encode uint8
     * @param self The uint8 to encode
     * @return The RLP encoded uint8 in bytes
     */
    function encodeUint8(uint8 self) public pure returns (bytes) {
        return encodeBytes(toBinary(self));
    }

    /**
     * @notice Encode int
     * @param self The int to encode
     * @return The RLP encoded int in bytes
     */
    function encodeInt(int self) public pure returns (bytes) {
        return encodeUint(uint(self));
    }

    /**
     * @notice Encode bool
     * @param self The bool to encode
     * @return The RLP encoded bool in bytes
     */
    function encodeBool(bool self) internal pure returns (bytes) {
        bytes memory rs = new bytes(1);
        if (self) {
            rs[0] = bytes1(1);
        }
        return rs;
    }

    /**
     * @notice Encode list of items
     * @param self The list of items to encode, each item in list must be already encoded
     * @return The RLP encoded list of items in bytes
     */
    function encodeList(bytes[] memory self) public pure returns (bytes) {
        bytes memory payload = new bytes(0);
        for (uint i = 0; i < self.length; i++) {
            payload = mergeBytes(payload, self[i]);
        }
        return mergeBytes(encodeLength(payload.length, LIST_OFFSET), payload);
    }



    function _encodeList(
        bytes nonce,
        bytes gasPrice,
        bytes gas,
        bytes to,
        bytes value,
        bytes data,
        bytes v,
        bytes r,
        bytes s
    ) public returns (bytes){
        tx_list.push(nonce);
        tx_list.push(gasPrice);
        tx_list.push(gas);
        tx_list.push(to);
        tx_list.push(value);
        tx_list.push(data);
        tx_list.push(v);
        tx_list.push(r);
        tx_list.push(s);

        return encodeList(tx_list);
    }

    /**
     * @notice Concat two bytes arrays
     * @dev This should be optimize with assembly to save gas costs
     * @param param1 The first bytes array
     * @param param2 The second bytes array
     * @return The merged bytes array
     */
    function mergeBytes(bytes param1, bytes param2) internal pure returns (bytes) {
        bytes memory merged = new bytes(param1.length + param2.length);
        uint k = 0;
        for (uint i = 0; i < param1.length; i++) {
            merged[k] = param1[i];
            k++;
        }

        for (i = 0; i < param2.length; i++) {
            merged[k] = param2[i];
            k++;
        }
        return merged;
    }

    /**
     * @notice Encode the first byte, followed by the `length` in binary form if `length` is more than 55.
     * @param length The length of the string or the payload
     * @param offset `STRING_OFFSET` if item is string, `LIST_OFFSET` if item is list
     * @return RLP encoded bytes
     */
    function encodeLength(uint length, uint offset) internal pure returns (bytes) {
        bytes memory encoded;
        if (length < 56) {
            encoded = new bytes(1);
            encoded[0] = byte(length + offset);
        } else {
            uint lenLen;
            uint i = 1;
            while (length / i != 0) {
                lenLen++;
                i *= 256;
            }

            encoded = new bytes(lenLen + 1);
            encoded[0] = byte(lenLen + offset + 55);
            for(i = 1; i <= lenLen; i++) {
                encoded[i] = byte((length / (256**(lenLen-i))) % 256);
            }
        }
        return encoded;
    }

    /**
     * @notice Encode integer in big endian binary form with no leading zeroes
     * @dev This should be optimize with assembly to save gas costs
     * @param x The integer to encode
     * @return RLP encoded bytes
     */
    function toBinary(uint x) internal pure returns (bytes) {
        bytes memory b = new bytes(32);
        assembly {
            mstore(add(b, 32), x)
        }
        for (uint i = 0; i < 32; i++) {
            if (b[i] != 0) {
                break;
            }
        }
        bytes memory rs = new bytes(32 - i);
        for (uint j = 0; j < rs.length; j++) {
            rs[j] = b[i++];
        }
        return rs;
    }

    /**
    * @dev Copies a piece of memory to another location.
    * @notice From: https://github.com/Arachnid/solidity-stringutils/blob/master/src/strings.sol.
    * @param _dest Destination location.
    * @param _src Source location.
    * @param _len Length of memory to copy.
    */
    function memcpy(uint _dest, uint _src, uint _len) private pure {
        uint dest = _dest;
        uint src = _src;
        uint len = _len;

        for(; len >= 32; len -= 32) {
            assembly {
                mstore(dest, mload(src))
            }
            dest += 32;
            src += 32;
        }

        uint mask = 256 ** (32 - len) - 1;
        assembly {
            let srcpart := and(mload(src), not(mask))
            let destpart := and(mload(dest), mask)
            mstore(dest, or(destpart, srcpart))
        }
    }

    /**
     * @dev Flattens a list of byte strings into one byte string.
     * @notice From: https://github.com/sammayo/solidity-rlp-encoder/blob/master/RLPEncode.sol.
     * @param _list List of byte strings to flatten.
     * @return The flattened byte string.
     */
    function flatten(bytes[] memory _list) private pure returns (bytes) {
        if (_list.length == 0) {
            return new bytes(0);
        }

        uint len;
        for (uint i = 0; i < _list.length; i++) {
            len += _list[i].length;
        }

        bytes memory flattened = new bytes(len);
        uint flattenedPtr;
        assembly { flattenedPtr := add(flattened, 0x20) }

        for(i = 0; i < _list.length; i++) {
            bytes memory item = _list[i];

            uint listPtr;
            assembly { listPtr := add(item, 0x20)}

            memcpy(flattenedPtr, listPtr, item.length);
            flattenedPtr += _list[i].length;
        }

        return flattened;
    }

    /**
     * @dev Concatenates two bytes.
     * @notice From: https://github.com/GNSPS/solidity-bytes-utils/blob/master/contracts/BytesLib.sol.
     * @param _preBytes First byte string.
     * @param _postBytes Second byte string.
     * @return Both byte string combined.
     */
    function concat(bytes memory _preBytes, bytes memory _postBytes) private pure returns (bytes) {
        bytes memory tempBytes;

        assembly {
            tempBytes := mload(0x40)

            let length := mload(_preBytes)
            mstore(tempBytes, length)

            let mc := add(tempBytes, 0x20)
            let end := add(mc, length)

            for {
                let cc := add(_preBytes, 0x20)
            } lt(mc, end) {
                mc := add(mc, 0x20)
                cc := add(cc, 0x20)
            } {
                mstore(mc, mload(cc))
            }

            length := mload(_postBytes)
            mstore(tempBytes, add(length, mload(tempBytes)))

            mc := end
            end := add(mc, length)

            for {
                let cc := add(_postBytes, 0x20)
            } lt(mc, end) {
                mc := add(mc, 0x20)
                cc := add(cc, 0x20)
            } {
                mstore(mc, mload(cc))
            }

            mstore(0x40, and(
            add(add(end, iszero(add(length, mload(_preBytes)))), 31),
            not(31)
            ))
        }

        return tempBytes;
    }
}

