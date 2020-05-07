

## Setup nodes

### plasma-evm
```bash
git clone https://github.com/Onther-Tech/plasma-evm.git
cd plasma-evm
git fetch
git checkout v0.0.0-rc6.0
bash run.childchain.sh # use ↓ script
```

```bash
#!/bin/bash

ADDR1="0x5E3230019fEd7aB462e3AC277E7709B9b2716b4F"
KEY1="86e60281da515184c825c3f46c7ec490b075af1e74607e2e9a66e3df0fa22122"

DATADIR=$HOME/.pls.staking/datadir
JSONRPC=ws://13.231.233.189:8546
PWD=$DATADIR/pwd.pass

GENESIS_1=$DATADIR/test-genesis.json

rm -rf $DATADIR
mkdir -p $DATADIR
make geth
touch $PWD

#######################
# SETUP NODE
#######################

# 0. unlock $KEY0 using geth account importKey
build/bin/geth account importKey $KEY1 --datadir $DATADIR <<EOF


EOF

# 1. deploy && init RootChain
build/bin/geth deploy $GENESIS_1 1021 true 2 \
  --datadir $DATADIR \
  --rootchain.url $JSONRPC \
  --unlock $ADDR1 \
  --password $PWD \
  --rootchain.sender $ADDR1
build/bin/geth init $GENESIS_1 \
  --datadir $DATADIR \
  --rootchain.url $JSONRPC

# 2. run chain and mine blocks..
build/bin/geth \
  --datadir $DATADIR \
  --rootchain.url $JSONRPC \
  --operator $ADDR1 \
  --rpc \
  --rpcport 8547  \
  --rpcapi eth,debug,net \
  --ws \
  --wsport 8548
```

## Usage

### config.js

```javascript
exports.operator = '0xb79749F25Ef64F9AC277A4705887101D3311A0F4';
exports.tokenHolder = '0x5E3230019fEd7aB462e3AC277E7709B9b2716b4F';

exports.rootchain = '0x6dd9f8f7b965573590dC17120702F1D779Aae2DE';
exports.tokenAtRootChain = '0x22875c5222421A34902c9B52Bbd4Cc3fbDA0141E';
exports.tokenAtChildChain = '0x2a578189fF099D56a1673e01294DBeCb6bBCbff9';

exports.NRELength = 2;
exports.currentBlockNumber = 11;
```

> The `operator` and `tokenHolder` do not need to be modified. `rootchain`, `tokenAtRootChain`, `tokenAtChildChain`, `NRELength`, and `currentBlockNumber`, these variables must be renewed by rotating the script below. Details can be found below.


### demo

1. In the `run.childchain.sh` script, enter the RootChain contact address directly in the config.js file. *(eg. exports.rootchain = '0x749EeF3EbADea15595294EF1Df71249fA8014594';)*
![image](https://user-images.githubusercontent.com/20399507/79987399-51549c00-84e8-11ea-9701-16945d979a07.png)
2. `npx truffle exec ./demo/rootchain/1_deploy_and_mint_token.js --network rinkeby` (Enter the token address directly in the config.js file. *(eg. exports.tokenAtRootChain = '0x22875c5222421A34902c9B52Bbd4Cc3fbDA0141E';)*)
3. `npx truffle exec ./demo/rootchain/get_balance.js --network rinkeby` (You can check the quantity of token minted.)
4. `npx truffle exec ./demo/childchain/2_deploy_token.js --network childchain` (Enter the token address directly in the config.js file. *(eg. exports.tokenAtChildChain = '0x2a578189fF099D56a1673e01294DBeCb6bBCbff9';)*)
5. `npx truffle exec ./demo/rootchain/3_map_contracts.js --network rinkeby`
6. `npx truffle exec ./demo/rootchain/4_enter.js --network rinkeby` (Start enter!)
7. `npx truffle exec ./demo/rootchain/5_get_NRE_length.js --network rinkeby` (Enter the NRE length  directly in the config.js file. *(eg. exports.NRELength = 2;)*)
8. `npx truffle exec ./demo/childchain/6_make_NRB_for_enter_requests.js --network childchain`
9. `npx truffle exec ./demo/childchain/get_balance.js --network childchain` (Check that enter requests are reflected.)
10. `npx truffle exec ./demo/rootchain/7_exit.js --network rinkeby` (Start exit!)
11. `npx truffle exec ./demo/childchain/8_make_NRB_for_exit_requests.js --network childchain`
12. `npx truffle exec ./demo/childchain/9_get_block_number.js --network childchain` (Enter the current block number in childchain directly in the config.js file. *(eg. exports.currentBlockNumber = 11;)*)
13. `npx truffle exec ./demo/rootchain/10_finalize_block.js --network rinkeby`
14. `npx truffle exec ./demo/rootchain/11_finalize_requests.js --network rinkeby`
15. `npx truffle exec ./demo/rootchain/get_balance.js --network rinkeby` (Check that exit requests are reflected.)
