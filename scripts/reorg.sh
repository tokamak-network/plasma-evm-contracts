#!/usr/bin/env bash

FORKINTERVAL=${1:-10}
REORGINTERVAL=${2:-5}
TXREMOVED=${3:-false}

ENODE="enode://bb9c918c07cfb577ecdfd3785a8da4c7fecc2ae1838191e7b43b35214d480e9d5eae2775bafeea87038243010edd7670a686ae30c5d5a025b03582fdedec58ba@[::]:30304?discport=0" # --nodekeyhex 5e048defbb082a83db7aa0c508696b70ecfb25de3973d7ea9cd5eeea2d295c17
PRIVATEKEY1="b71c71a67e1177ad4e901695e1b4b9ee17ae16c6668d313eac2f96dbcda3f291"
PRIVATEKEY2="78ae75d1cd5960d87e76a69760cb451a58928eee7890780c352186d23094a114"
ADDRESS1="0x71562b71999873db5b286df957af199ec94617f7"
ADDRESS2="0x3616be06d68dd22886505e9c2caaa9eca84564b8"

mkdir $(pwd)/scripts/temp

clean() {
    rm -rf $(pwd)/scripts/temp
    exit 2
}

trap clean SIGINT 

echo "forkinterval=$FORKINTERVAL, reorginterval=$REORGINTERVAL"

# https://ethereum.stackexchange.com/questions/10033/can-i-pass-arguments-to-a-js-script-on-geth 
echo "personal.importRawKey('$PRIVATEKEY1', '', function (err) {}); personal.importRawKey('$PRIVATEKEY2', '', function (err) {}); personal.unlockAccount('$ADDRESS1', '', 0); personal.unlockAccount('$ADDRESS2', '', 0); console.log('Data: accounts=[' + eth.accounts + ']');" > $(pwd)/scripts/temp/init.js
geth --jspath "$(pwd)/scripts/temp" --exec 'loadScript("init.js")' \
attach http://127.0.0.1:8545 | grep "Data: " | sed "s/Data: //"

if [ "$TXREMOVED" == true ]
then
    geth --exec "miner.setGasPrice(1e18)" attach http://127.0.0.1:8645 | grep "Data: " | sed "s/Data: //"
else
    geth --exec "miner.setGasPrice(1)" attach http://127.0.0.1:8645 | grep "Data: " | sed "s/Data: //"
fi

echo "miner.stop(); admin.addPeer('$ENODE'); admin.sleepBlocks($REORGINTERVAL); console.log('Data: mining=' + eth.mining + ', peers=' + admin.peers.length + ', number=' + eth.blockNumber);" > $(pwd)/scripts/temp/fork.js
echo "miner.start(); admin.removePeer('$ENODE'); admin.sleepBlocks($FORKINTERVAL); console.log('Data: mining=' + eth.mining + ', peers=' + admin.peers.length + ', number=' + eth.blockNumber);" > $(pwd)/scripts/temp/reorg.js

reorg() {
    echo start reorg
    geth --jspath "$(pwd)/scripts/temp" --exec 'loadScript("fork.js")' \
    attach http://127.0.0.1:8545 | grep "Data: " | sed "s/Data: //"
}
 
fork() {
    echo start fork
    geth --jspath "$(pwd)/scripts/temp" --exec 'loadScript("reorg.js")' \
    attach http://127.0.0.1:8545 | grep "Data: " | sed "s/Data: //"
}

pinggeth() {
    if ! nc -vz localhost 8545; then
        clean
    fi
}

while true
do
    # reorg -> 1 2 3 4 5 6 7 8 9 10 (fork interval) -> fork -> 11 12 13 14 15 (reorg interval) -> reorg -> ...
    pinggeth; reorg
    pinggeth; fork
done
