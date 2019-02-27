module.exports = function(callback) {
    // perform actions
    // console.log(callback);
};

const path = require("path");
const fs = require("fs");
const Web3 = require("web3");
const Promise = require("bluebird");

const { appendHex } = require('./test/helpers/appendHex');
const { marshalString, unmarshalString } = require('./test/helpers/marshal');

const abiPath = path.join(__dirname, 'build', 'contracts', 'RequestableSimpleToken.json');
const abi = JSON.parse(fs.readFileSync(abiPath).toString()).abi;
const bytecode = JSON.parse(fs.readFileSync(abiPath).toString()).bytecode;

const abiPathRC = path.join(__dirname, 'build', 'contracts', 'RootChain.json');
const abiRC = JSON.parse(fs.readFileSync(abiPathRC).toString()).abi;

// host:
const httpProviderUrlChild = "http://172.30.1.23:8547";
const web3c = new Web3(new Web3.providers.HttpProvider(httpProviderUrlChild));

const RequestableSimpleToken = artifacts.require('RequestableSimpleToken.sol');

const BigNumber = web3.BigNumber;

const DEFAULT_PAD_LENGTH = 2 * 32;

const etherAmount = new BigNumber(10e18);
const tokenAmount = new BigNumber(1e18);
const exitAmount = new BigNumber(7.7e15);
const emptyBytes32 = 0;

const operator = "0x71562b71999873DB5b286dF957af199Ec94617F7".toLowerCase();
const user = "0x5df7107c960320b90a3d7ed9a83203d1f98a811d".toLowerCase();

// send 10 ETH in rootchain
// for (var i=1; i<5; i++) {
//     web3.eth.sendTransaction({from: web3.eth.accounts[0], value: etherAmount, to: web3.eth.accounts[i]});
// }
// use bluebird
if (typeof web3.eth.getAccountsPromise === "undefined") {
  Promise.promisifyAll(web3.eth);
}

// deploy requestable contract on childchain
async function exec() {
    // Deploy //
    // deploy requestable contract on rootchain
    const tokenR = await RequestableSimpleToken.new();
    const receipt = await tokenR.mint(user, tokenAmount.mul(100));
    await waitTx(receipt.tx);
    console.log("tokenR address:", tokenR.address);

    // get rootchain address from child chain
    const rcaddr = await web3c.eth.rootchain();
    const rootchain = await web3.eth.contract(abiRC).at(rcaddr);
    console.log(`RootChain Address: ${rcaddr}`);
    Promise.promisifyAll(rootchain);

    const previousNumEROs = await rootchain.getNumEROsAsync();
    console.log('Previous RootChain num EROs : ', previousNumEROs.toNumber());

    // deploy requestable contract on childchain
    const tokenCabi = web3c.eth.contract(abi);
    const tokenC = await deployToken(tokenCabi, {from: operator, gas: 3000000, data: "0x608060405260008054600160a060020a031916331790556108b4806100256000396000f3006080604052600436106100a35763ffffffff7c010000000000000000000000000000000000000000000000000000000060003504166318160ddd81146100a857806327e235e3146100cf57806340c10f19146100f0578063715018a6146101165780638da5cb5b1461012b578063a9059cbb1461015c578063b18fcfdf14610180578063d9afd3a9146101a1578063e904e3d9146101e4578063f2fde38b14610213575b600080fd5b3480156100b457600080fd5b506100bd610234565b60408051918252519081900360200190f35b3480156100db57600080fd5b506100bd600160a060020a036004351661023a565b3480156100fc57600080fd5b50610114600160a060020a036004351660243561024c565b005b34801561012257600080fd5b50610114610347565b34801561013757600080fd5b506101406103b3565b60408051600160a060020a039092168252519081900360200190f35b34801561016857600080fd5b50610114600160a060020a03600435166024356103c2565b34801561018c57600080fd5b506100bd600160a060020a0360043516610475565b3480156101ad57600080fd5b506101d06004351515602435600160a060020a036044351660643560843561049a565b604080519115158252519081900360200190f35b3480156101f057600080fd5b506101d06004351515602435600160a060020a0360443516606435608435610662565b34801561021f57600080fd5b50610114600160a060020a03600435166107b8565b60015481565b60026020526000908152604090205481565b600054600160a060020a0316331461026357600080fd5b600154610276908263ffffffff6107db16565b600155600160a060020a0382166000908152600260205260409020546102a2908263ffffffff6107db16565b600160a060020a03831660008181526002602090815260409182902093909355805191825291810183905281517f0f6798a560793a54c3bcfe86a93cde1e73087d944c0ea20544137d4121396885929181900390910190a16040805160008152600160a060020a038416602082015280820183905290517fddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef9181900360600190a15050565b600054600160a060020a0316331461035e57600080fd5b60008054604051600160a060020a03909116917ff8df31144d9c2f0f6b59d69b8b98abd5459d07f2742c4df920b25aae33c6482091a26000805473ffffffffffffffffffffffffffffffffffffffff19169055565b600054600160a060020a031681565b336000908152600260205260409020546103e2908263ffffffff6107f416565b3360009081526002602052604080822092909255600160a060020a03841681522054610414908263ffffffff6107db16565b600160a060020a03831660008181526002602090815260409182902093909355805133815292830191909152818101839052517fddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef9181900360600190a15050565b60408051600160a060020a039290921682526002602083015280519182900301902090565b60008481526003602052604081205460ff16156104b657600080fd5b851561054b578215156104f0576000805473ffffffffffffffffffffffffffffffffffffffff1916600160a060020a038616179055610546565b60018314156104fe57610546565b60408051600160a060020a038616815260026020820152815190819003909101902083141561054657600160a060020a03841660009081526002602052604090208054830190555b6105e8565b82151561056c57600054600160a060020a0385811691161461054657600080fd5b600183141561057a57600080fd5b60408051600160a060020a03861681526002602082015281519081900390910190208314156100a357600160a060020a0384166000908152600260205260409020548211156105c857600080fd5b600160a060020a0384166000908152600260205260409020805483900390555b600085815260036020908152604091829020805460ff1916600117905581518815158152600160a060020a038716918101919091528082018590526060810184905290517f1607eee29334711e8e6be82c8fd0b4aebd9951a9bcbcaa82da0abc1ce57dbb879181900360800190a150600195945050505050565b60008481526003602052604081205460ff161561067e57600080fd5b851561072a578215156106aa57600054600160a060020a038581169116146106a557600080fd5b610546565b60018314156106b857600080fd5b60408051600160a060020a03861681526002602082015281519081900390910190208314156100a357600160a060020a03841660009081526002602052604090205482111561070657600080fd5b600160a060020a038416600090815260026020526040902080548390039055610546565b82151561075e576000805473ffffffffffffffffffffffffffffffffffffffff1916600160a060020a0386161790556105e8565b600183141561076c576105e8565b60408051600160a060020a03861681526002602082015281519081900390910190208314156100a357600160a060020a03841660009081526002602052604090208054830190556105e8565b600054600160a060020a031633146107cf57600080fd5b6107d88161080b565b50565b6000828201838110156107ed57600080fd5b9392505050565b6000808383111561080457600080fd5b5050900390565b600160a060020a038116151561082057600080fd5b60008054604051600160a060020a03808516939216917f8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e091a36000805473ffffffffffffffffffffffffffffffffffffffff1916600160a060020a03929092169190911790555600a165627a7a723058201ce2db4968d05358e3e6602c86d3bb67427abc20ee83d1305e0af0ea957cf00f0029"});
    // console.log('deployed object', deployed.transactionHash)
    while ((await web3c.eth.getTransactionReceipt(tokenC.transactionHash)) === null) {
        await wait(1);
    }


    // Test Tx Sending //
    // const tokenCreceipt = await web3c.eth.getTransactionReceipt(deployed.transactionHash)
    console.log("await rootchain.requestableContracts(tokenR.address)", await rootchain.requestableContractsAsync(tokenR.address));

    await wait(5) // Have to increase enough Time to waiting

    const tx = await rootchain.mapRequestableContractByOperatorAsync(tokenR.address, tokenC.address, {from: operator});

    await waitTx(tx);

    if ((await web3.eth.getTransactionReceiptAsync(tx)).status == "0x0") {
        console.error("Failed to map requestable contract. check tx: ", tx);
        process.exit(-1);
    } else {
        console.log("Sucess to map requestable contract, check tx : ", tx)
    }

    console.log("await rootchain.requestableContracts(tokenR.address)", await rootchain.requestableContractsAsync(tokenR.address));

    // Secondary Try to Token mint, but Failed
//     const mintReceipt = await tokenR.mint(user, tokenAmount.mul(100));
//     await waitTx(mintReceipt)

    // make enter request in rootchain
    // await enter(3, rootchain, tokenR.address);
    for (i = 0; i < 4; i++ ) {
        let enterReceipt = await rootchain.startEnterAsync(tokenR.address, calcTrieKey(user), padLeft(web3.fromDecimal(tokenAmount)), {from: user, gas: 1000000});
        console.log("startEnter : ", enterReceipt)
        await wait(5);
    }

    console.log("finish to make enterRequest");

    const numEROS = await rootchain.getNumEROsAsync();
    console.log('RootChain num EROs: ', numEROS);

    // send PETH in childchain
    // For making blocks in plasma childchain.
    for (i = 0; i < 4; i++ ) {
        await web3c.eth.sendTransaction({from: user, to: user, value: 0})
        await wait(1)
    }

    console.log("send PETH in childchain");

    await wait(5)

    // check Token balance in Childchain
    console.log("Token balance in childchain", tokenC.balances(user))

    let exitReceipt = await rootchain.startExitAsync(tokenR.address, calcTrieKey(user), padLeft(web3.fromDecimal(exitAmount)), {from: user, gas: 4000000, value: 1e18});
    console.log("startExit : ", exitReceipt);

    await wait(5);

    let applyReceipt = await rootchain.applyRequestAsync({from: opreator, gas: 1000000})
    console.log("apply Request : ", applyReceipt);

    for (i = 0; i < 4; i++ ) {
        await web3c.eth.sendTransaction({from: user, to: user, value: 0})
        await wait(1)
    }

    console.log("send PETH in childchain");
    console.log("Token balance in childchain", tokenC.balances(user))

}


function deployToken(tokenC, transactionOpt) {
    return new Promise((resolve, reject) => {
        tokenC.new(transactionOpt, function (err, res) {
            if (err) reject(err);
            if (res) resolve(res);
        })
    })
}


function wait (sec) {
    return new Promise(resolve => {
        setTimeout(() => {
            resolve();
        }, sec * 1000);
    })
}

async function waitTx(hash) {
    let receipt
    while (!(receipt =await web3.eth.getTransactionReceiptAsync(hash))) {
        await wait(1);
    }

    console.log(`${hash}: ${JSON.stringify(receipt)}`);

    if (receipt.status === "0x0") {
        console.error(`${hash} is reverted.`);
    }
}

function padLeft (str, padLength = DEFAULT_PAD_LENGTH) {
    const v = web3.toHex(str);
    return marshalString(web3.padLeft(unmarshalString(v), padLength));
}

async function waitTx(hash) {
    let receipt
    while (!(receipt =await web3.eth.getTransactionReceiptAsync(hash))) {
        await wait(1);
    }

    console.log(`${hash}: ${JSON.stringify(receipt)}`);

    if (receipt.status === "0x0") {
        console.error(`${hash} is reverted.`);
    }
}

function calcTrieKey (addr) {
    return web3.sha3(appendHex(padLeft(addr), padLeft('0x02')), { encoding: 'hex' });
}

(async function () {
    try {
        await exec();
    }
    catch (e) {
        console.log(e);
    }
})();


