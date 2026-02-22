# UTXO Organisms

Programmable, self-replicating UTXOs on BSV.

A UTXO organism is a covenant-locked output that enforces its own lifecycle rules through script. Each spend ("reproduction") creates a new UTXO with the same rules, increments a generation counter, pays a small reward to whoever triggered it, and deducts a miner fee — all from the organism's own balance. When the balance hits dust, the organism dies. No owner. No server. No admin key.

## Quick Start

```bash
# Clone
git clone https://github.com/axiemaid/utxo-organisms.git
cd utxo-organisms

# Install & compile
npm install
npm run compile

# Create a wallet
node wallet.cjs create

# Send BSV to the address it gives you, then:

# Spawn a heartbeat organism (type 0)
node spawn.cjs --type 0 --budget 100000 --reward 1000 --fee 3000

# Trigger reproduction on a living organism
node claim.cjs --txid <organism-txid> --address <your-bsv-address>

# Feed an organism (extend its life)
node fund.cjs --txid <organism-txid> --amount 50000 --wallet wallet.json

# Scan all known organisms
node scanner.cjs
```

## How It Works

1. **Spawn** creates a UTXO locked to the organism covenant with an initial budget
2. Anyone can **reproduce** the organism by spending its UTXO — the covenant enforces that a new UTXO with the same script is created
3. Each reproduction pays a dust-level reward to the person who triggered it
4. The organism pays its own miner fees — participants need zero BSV
5. When the budget runs out, the organism **dies** — no more reproductions possible

Every reproduction includes an `OP_RETURN` with the `ORG1` protocol prefix, making all organisms discoverable by any scanner on the network.

## ORG1 Protocol

Every organism transaction includes an OP_RETURN output:

```
OP_FALSE OP_RETURN "ORG1" <type:1B> <generation:4B> <spawnTxid:32B> [payload...]
```

| Field | Description |
|-------|-------------|
| `ORG1` | Protocol identifier |
| Type | Organism type (0 = heartbeat, 1 = task, etc.) |
| Generation | Current generation counter (uint32 LE) |
| Spawn TXID | Genesis transaction (groups all generations of one lineage) |
| Payload | Type-specific data (optional) |

See [docs/SCHEMA.md](docs/SCHEMA.md) for the full specification.

## Organism Types

| Type | Name | Description |
|------|------|-------------|
| 0 | Heartbeat | Pure survival — no payload. Proves the covenant works. |
| 1 | Task | Each generation records a task-result pair on-chain. |
| 2 | Handshake | Requires co-signed input — spend is proof of interaction. |
| 3+ | [More types planned](docs/TYPES.md) | Chain crawler, particle swarm, mutex, predator/prey, etc. |

## CLI Tools

| Tool | Description |
|------|-------------|
| `wallet.cjs` | Create a wallet, show address, check balance |
| `spawn.cjs` | Deploy a new organism to mainnet |
| `claim.cjs` | Trigger reproduction on a living organism |
| `fund.cjs` | Feed an organism — increase its balance, extend its life |
| `scanner.cjs` | Find and trace all ORG1 organisms |

## Why

UTXO organisms are coordination infrastructure. The per-generation reward is near-dust — it's gas money, not compensation. Participants are aligned through BSV holdings: the network of working organisms demonstrates utility, which drives adoption, which increases the value of the network.

On-chain participation history becomes verifiable reputation. A portable, uncensorable credential that no platform controls.

The organism's value isn't the sats inside it. It's the permanent, miner-validated record of work done.

## Docs

- [Schema specification](docs/SCHEMA.md)
- [Organism type definitions](docs/TYPES.md)

## License

MIT
