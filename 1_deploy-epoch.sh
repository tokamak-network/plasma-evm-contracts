cat << EOF > deployed.json
{
  "TON":"0x3734E35231abE68818996dC07Be6a8889202DEe9",
  "WTON":"0x9985d94ee25a1eB0459696667f071ECE121ACce6",
  "Layer2Registry":"0x4d031C0E74cE863F3885342C4FF6B6557449f068",
  "DepositManager":"0x43dC0927Ca673Dd010393f01ad3EA9c5E45e2896",
  "SeigManager":"0xdb6046F3b59395A126a324E63aC93f4c38119055",
  "PowerTON":"0x5498AFFd9A0d22Ee7607658e0C6782d26766Da1e"
}
EOF

export RINKEBY_PROVIDER_URL=$1

cat deployed.json

export RINKEBY_PRIVATE_KEY=$2
export SET_OPERATOR=true
export epoch=true

sed -i.bak '847,852d' node_modules/request/request.js

truffle migrate --network rinkeby