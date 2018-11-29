# Plasma EVM RootChain contract

`truffle test` may fail in testrpc.  [run.rootchain.sh](https://github.com/Onther-Tech/go-ethereum/blob/master/run.rootchain.sh) in [Onther-Tech/go-ethereum](https://github.com/Onther-Tech/go-ethereum) is highly recommended to the test client.

## implementation Status

-   [x] Make enter / exit requests
-   [x] Submit NRBs / ORBs
-   [x] Finalize block and requests
-   [ ] Challenge on Exit
-   [ ] Disable ether exit request
-   [ ] Challenge on Null Address Transaction in NRBs

## Development

The contracts can be deployed in ethereum and plasma chain. Check the `truffle-config.js` and set up the networks accroding to it. For the simple start of development, just run [run.rootchain.sh](https://github.com/Onther-Tech/go-ethereum/blob/master/run.rootchain.sh) in [Onther-Tech/go-ethereum](https://github.com/Onther-Tech/go-ethereum) and [run.pls.sh](https://github.com/Onther-Tech/plasma-evm/blob/develop/run.pls.sh) in [Onther-Tech/plasma-evm](https://github.com/Onther-Tech/plasma-evm).
(END)

## Lint

```bash
npm run lint
```
