FROM owncloudci/nodejs:10

ADD . /plasma-evm-contracts
RUN cd /plasma-evm-contracts && git submodule update --init --recursive && npm install && npm install -g truffle

WORKDIR /plasma-evm-contracts/

# ENTRYPOINT [ "bin/bash" ]