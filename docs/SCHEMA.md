# ORG1 Protocol Schema

## Transaction Structure

Every organism transaction follows this output layout:

| Output | Content | Value |
|--------|---------|-------|
| 0 | Organism continuation (same locking script, reduced balance) | Budget - reward - fee |
| 1 | OP_RETURN with ORG1 protocol data | 0 |
| 2 | Reward payment to claimer (P2PKH) | Reward amount |

When the organism dies (balance < dust limit after deductions), output 0 is omitted.

## OP_RETURN Format

```
OP_FALSE OP_RETURN "ORG1" <type> <generation> <spawnTxid> [<payload>...]
```

Each field is a separate pushdata:

| Field | Size | Encoding | Description |
|-------|------|----------|-------------|
| Prefix | 4 bytes | ASCII | Always `ORG1` (`0x4f524731`) |
| Type | 1 byte | uint8 | Organism type (0-255) |
| Generation | 4 bytes | uint32 LE | Current generation counter |
| Spawn TXID | 32 bytes | raw | Genesis TX ID (all zeros at gen 0) |
| Payload | variable | type-specific | Optional, depends on organism type |

## Covenant Enforcement

The locking script (sCrypt contract) has two methods:

### claim (reproduce)
1. **Propagation**: Output 0 must have the same locking script as the input
2. **Budget**: Output 0 value = input value - reward - fee
3. **Generation**: Counter increments by exactly 1
4. **OP_RETURN**: Output 1 must contain valid ORG1 data matching the organism's state
5. **Reward**: Output 2 pays the claimer's address
6. **Death**: If next balance < dust limit, no continuation output (organism dies)

The miner fee is implicit: input value - sum of output values = fee.

### fund (feed)
1. **Propagation**: Output 0 must have the same locking script
2. **Balance increase**: Output 0 value must be greater than input value
3. **No reproduction**: Generation stays the same, no reward paid
4. **OP_RETURN**: Output 1 with same ORG1 data (unchanged generation)

The funder provides additional inputs to cover the increased balance + miner fee.

## Discovery

To find all ORG1 organisms on the network:

1. Search for transactions containing `OP_FALSE OP_RETURN` with the `ORG1` (`4f524731`) prefix
2. Decode common fields (type, generation, spawn TXID)
3. Group by spawn TXID to identify lineages
4. Follow output 0 spends to trace the full lineage

## Organism Types

| Type | Name | Payload | Status |
|------|------|---------|--------|
| 0 | Heartbeat | None | Implemented |
| 1 | Task | Task hash, result hash, claimer PKH | Planned |
| 2 | Handshake | Co-signer PKH, attestation data | Planned |
| 3 | Chain Crawler | Target TXID, digest | Planned |
| 4 | Particle Swarm | Position, velocity, personal best, global best ref | Planned |
| 5 | Mutex | Holder PKH, lock time | Planned |
| 6 | Predator/Prey | Species, energy | Planned |
| 7 | Reputation | Subject PKH, count, interaction hash | Planned |
| 8 | Signal Relay | Watched TXID, block window, triggered flag | Planned |

See [TYPES.md](TYPES.md) for detailed payload specifications.
