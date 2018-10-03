# Plasma EVM RootChain contract

- Epoch is reverted if any block in the epoch is challenged
- Non request epoch is finalized if next request epoch is finalizable (challenge period ends)
- Non request epoch is finalized if all blocks are not successfully challenged during challenge period
- Request epoch is finalized if all blocks are not successfully challenged during challenge period


#### TODOs
- Finalize requests
