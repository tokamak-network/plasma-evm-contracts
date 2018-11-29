# Plasma EVM RootChain contract

[![Build Status](https://travis-ci.org/Onther-Tech/plasma-evm-contracts.svg?branch=master)](https://travis-ci.org/Onther-Tech/plasma-evm-contracts)


## Implementation Status

-   [x] Make enter / exit requests
-   [x] Submit NRBs / ORBs
-   [x] Finalize block and requests
-   [x] Challenge on Exit
-   [ ] Challenge on Null Address Transaction in NRBs

## Development

The contracts can be deployed in ethereum and plasma chain. Check the `truffle-config.js` and set up the networks accroding to it. For the simple start of development, just run [run.rootchain.sh](https://github.com/Onther-Tech/go-ethereum/blob/master/run.rootchain.sh) in [Onther-Tech/go-ethereum](https://github.com/Onther-Tech/go-ethereum) and [run.pls.sh](https://github.com/Onther-Tech/plasma-evm/blob/develop/run.pls.sh) in [Onther-Tech/plasma-evm](https://github.com/Onther-Tech/plasma-evm).

## Lint

```bash
npm run lint
```
