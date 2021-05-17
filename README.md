# Deployed contracts on mainnet

## Tokens

- TON: [0x2be5e8c109e2197D077D13A82dAead6a9b3433C5](https://etherscan.io/address/0x2be5e8c109e2197D077D13A82dAead6a9b3433C5)
- WTON: [0xc4A11aaf6ea915Ed7Ac194161d2fC9384F15bff2](https://etherscan.io/address/0xc4A11aaf6ea915Ed7Ac194161d2fC9384F15bff2)

## Managers

- DepositManager: [0x56E465f654393fa48f007Ed7346105c7195CEe43](https://etherscan.io/address/0x56E465f654393fa48f007Ed7346105c7195CEe43)
- SeigManager: [0x710936500aC59e8551331871Cbad3D33d5e0D909](https://etherscan.io/address/0x710936500aC59e8551331871Cbad3D33d5e0D909)

## ETC

- PowerTON: [0xd86d8950A4144D8a258930F6DD5f90CCE249E1CF](https://etherscan.io/address/0xd86d8950A4144D8a258930F6DD5f90CCE249E1CF)
- Layer2Registry: [0x0b3E174A2170083e770D5d4Cf56774D221b7063e](https://etherscan.io/address/0x0b3E174A2170083e770D5d4Cf56774D221b7063e)
- CoinageFactory: [0x5b40841eeCfB429452AB25216Afc1e1650C07747](https://etherscan.io/address/0x5b40841eeCfB429452AB25216Afc1e1650C07747)
- DaoVault: [0x45AC3B12C38b6ab085ED5Bc2b30F99b3E3B1e726](https://etherscan.io/address/0x45AC3B12C38b6ab085ED5Bc2b30F99b3E3B1e726)


# Plasma EVM RootChain contract

[![Build Status](https://travis-ci.org/Onther-Tech/plasma-evm-contracts.svg?branch=master)](https://travis-ci.org/Onther-Tech/plasma-evm-contracts)
[![Discord](https://img.shields.io/badge/discord-join%20chat-blue.svg)](https://discord.gg/8wSpJKz)


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
