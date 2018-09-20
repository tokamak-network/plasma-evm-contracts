module.exports = {
    norpc: true,
    testCommand: 'node --max-old-space-size=4096 truffle test --network coverage',
    compileCommand: 'node --max-old-space-size=4096 truffle compile --network coverage',
    skipFiles: [
    ]
}
