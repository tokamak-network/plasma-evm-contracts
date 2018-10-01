pragma solidity ^0.4.24;

import "./RLPEncode.sol";

contract TransactionTest {
    using RLPEncode for *;

    bytes[] tx_list;

    struct TX {
        uint8 nonce;
        uint gasPrice;
        uint gas;
        address to;
        uint value;
        bytes data;
        uint8 v;
        uint256 r;
        uint256 s;
    }

    function hash(
        uint8 nonce,
        uint gasPrice,
        uint gas,
        address to,
        uint value,
        bytes data,
        uint8 v,
        uint256 r,
        uint256 s
    ) public returns (bytes memory) {
        TX memory tx;
        bytes memory pack;

        bytes memory eList = new bytes(0);

        tx.nonce = nonce;
        tx.gasPrice = gasPrice;
        tx.gas = gas;
        tx.to = to;
        tx.value = value;
        tx.data = data;
        tx.v = v;
        tx.r = r;
        tx.s = s;

        //        bytes eNonce = RLPEncode.encodeUint(nonce);
        //        bytes eGasPrice = RLPEncode.encodeUint(gasPrice);
        //        bytes eGas = RLPEncode.encodeUint(gas);
        //        bytes eTo = RLPEncode.encodeAddress(to);
        //        bytes eValue = RLPEncode.encodeUint(value);
        //        bytes eData = RLPEncode.encodeBytes(data);
        //        bytes eV = RLPEncode.encodeUint(v);
        //        bytes eR = RLPEncode.encodeUint(r);
        //        bytes eS = RLPEncode.encodeUint(s);



        tx_list.push(RLPEncode.encodeUint(nonce));
        tx_list.push(RLPEncode.encodeUint(gasPrice));
        tx_list.push(RLPEncode.encodeUint(gas));
        tx_list.push(RLPEncode.encodeAddress(to));
        tx_list.push(RLPEncode.encodeUint(value));
        tx_list.push(RLPEncode.encodeBytes(data));
        tx_list.push(RLPEncode.encodeUint(v));
        tx_list.push(RLPEncode.encodeUint(r));
        tx_list.push(RLPEncode.encodeUint(s));


        return RLPEncode.encodeUint(tx_list);

    }

}
