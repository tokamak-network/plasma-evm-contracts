#!/usr/bin/env bash

~/workspace/go-ethereum_onther/build/bin/geth --jspath "./" --exec 'loadScript("removePeer.js")' \
attach ~/workspace/go-ethereum_onther/build/bin/testnode1/geth.ipc; \
