# Organism Types

All types share the base covenant (propagation, generation counting, reward payment, death). They differ only in their OP_RETURN payload and any additional spending conditions.

## Type 0: Heartbeat

Pure survival. No payload beyond the common fields.

**Payload:** None

**Purpose:** Proves the covenant works. Demonstrates self-replicating, self-funding UTXOs.

---

## Type 1: Task

Each generation is a task-result pair. Creates a verifiable record of work done on-chain.

**Payload:**

| Field | Size | Description |
|-------|------|-------------|
| Task Hash | 32 bytes | SHA-256 of task description |
| Result Hash | 32 bytes | SHA-256 of result data |
| Claimer PKH | 20 bytes | Who completed this task |

Task descriptions and results live off-chain (IPFS, web, etc). The hashes anchor them. The full chain of hashes becomes a verifiable, immutable work log.

---

## Type 2: Handshake

Spending requires a co-signed input from a specific address. The spend is proof of interaction.

**Payload:**

| Field | Size | Description |
|-------|------|-------------|
| Co-signer PKH | 20 bytes | Required co-signer address |
| Attestation | variable | Arbitrary attestation data |

**Additional spending condition:** Transaction must include a signed input from the co-signer's key.

---

## Type 3: Chain Crawler

A UTXO that references and indexes on-chain data as it propagates.

**Payload:**

| Field | Size | Description |
|-------|------|-------------|
| Target TXID | 32 bytes | Transaction being referenced |
| Digest | variable | Extracted data or hash |

---

## Type 4: Particle Swarm

Multiple instances run in parallel, each updating its position toward a global optimum.

**Payload:**

| Field | Size | Description |
|-------|------|-------------|
| Position | variable | Current position vector (fixed-point) |
| Velocity | variable | Current velocity vector |
| Personal Best | variable | Best position this particle has seen |
| Global Best Ref | 32 bytes | TXID of OP_RETURN with current global best |

---

## Type 5: Mutex

On-chain concurrency primitive. A lock that can be acquired and released via transactions.

**Payload:**

| Field | Size | Description |
|-------|------|-------------|
| Holder PKH | 20 bytes | Current lock holder |
| Lock Time | 4 bytes | Block height when acquired |

---

## Type 6: Predator/Prey

Two sub-types with population dynamics. Predators consume prey UTXOs.

**Payload:**

| Field | Size | Description |
|-------|------|-------------|
| Species | 1 byte | `0x00` = prey, `0x01` = predator |
| Energy | 8 bytes | Accumulated energy (predators absorb prey sats) |

**Additional spending condition (predator):** May include a prey organism UTXO as an additional input.

---

## Type 7: Reputation Accumulator

Script-enforced counter that tracks interactions for an address.

**Payload:**

| Field | Size | Description |
|-------|------|-------------|
| Subject PKH | 20 bytes | Address being tracked |
| Count | 4 bytes | Interaction count (can only increment) |
| Interaction Hash | 32 bytes | Proof of this interaction |

---

## Type 8: Signal Relay

Domino logic — one organism's spend triggers another.

**Payload:**

| Field | Size | Description |
|-------|------|-------------|
| Watched TXID | 32 bytes | UTXO this relay watches |
| Block Window | 4 bytes | Must fire within N blocks of watched spend |
| Triggered | 1 byte | `0x00` = waiting, `0x01` = fired |
