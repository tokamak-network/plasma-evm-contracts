personal.unlockAccount("0xefb33e48efb3773a73ca690161bbe722c1bf9c09", "")
var batch = web3.createBatch();
batch.add(web3.eth.sendTransaction({from:"0xefb33e48efb3773a73ca690161bbe722c1bf9c09", to:"0x544d81112fcd6f11683092035f547b922b3805fb", value: 1}));
batch.add(web3.eth.sendTransaction({from:"0xefb33e48efb3773a73ca690161bbe722c1bf9c09", to:"0x544d81112fcd6f11683092035f547b922b3805fb", value: 1}));
batch.add(web3.eth.sendTransaction({from:"0xefb33e48efb3773a73ca690161bbe722c1bf9c09", to:"0x544d81112fcd6f11683092035f547b922b3805fb", value: 1}));
batch.add(web3.eth.sendTransaction({from:"0xefb33e48efb3773a73ca690161bbe722c1bf9c09", to:"0x544d81112fcd6f11683092035f547b922b3805fb", value: 1}));
batch.add(web3.eth.sendTransaction({from:"0xefb33e48efb3773a73ca690161bbe722c1bf9c09", to:"0x544d81112fcd6f11683092035f547b922b3805fb", value: 1}));
batch.execute();


