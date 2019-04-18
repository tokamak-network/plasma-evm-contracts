#!/usr/bin/env bash

~/workspace/go-ethereum_onther/build/bin/geth --jspath "../../../plasma-evm-contracts/scripts/reorg-test" --exec 'loadScript("addPeer.js")' \
attach ~/workspace/go-ethereum_onther/build/bin/testnode1/geth.ipc \
