# UTXO Organisms

Programmable, self-replicating UTXOs on BSV.

A UTXO organism is a covenant-locked output that enforces its own lifecycle through script. Each spend ("reproduction") creates a new UTXO with the same rules, increments a generation counter, pays a dust-level reward to whoever triggered it, and deducts a miner fee — all from the organism's own balance. When the balance hits dust, it dies. No owner. No server. No admin key.

Anyone can feed an organism to extend its life. Anyone can trigger reproduction to earn a reward. Everything is on-chain, miner-validated, and discoverable via the ORG1 protocol prefix.

## Quick Start

```bash
git clone https://github.com/axiemaid/utxo-organisms.git
cd utxo-organisms
npm install
npm run compile

# Create a wallet
node wallet.cjs create
# Send BSV to the address it gives you

# Spawn a type 0 organism with 100k sats
node spawn.cjs --type 0 --budget 100000 --reward 1000 --fee 3000

# Trigger reproduction
node claim.cjs --txid <organism-txid> --address <your-bsv-address>

# Feed an organism (extend its life)
node fund.cjs --txid <organism-txid> --amount 50000 --wallet wallet.json

# Scan all known organisms
node scanner.cjs
```

## How It Works

### Reproduction
1. **Spawn** creates a UTXO locked to the organism covenant with an initial budget
2. Anyone can **reproduce** it — the covenant enforces a new UTXO with the same script is created
3. Each reproduction pays a dust-level reward to the person who triggered it
4. The organism pays its own miner fees — participants need zero BSV
5. When the budget runs out, the organism **dies**

### Feeding
Anyone can **feed** an organism by sending it additional sats. This increases its balance (and lifespan) without triggering reproduction. Generation stays the same. Change is returned to the funder.

## ORG1 Protocol

Every organism transaction includes an OP_RETURN output:

```
OP_FALSE OP_RETURN "ORG1" <type:1B> <generation:4B> <spawnTxid:32B> [payload...]
```

| Field | Description |
|-------|-------------|
| `ORG1` | Protocol identifier — makes all organisms discoverable |
| Type | Self-assigned species identifier (1 byte) |
| Generation | Counter, incremented by covenant (uint32 LE) |
| Spawn TXID | Genesis transaction — groups all generations of one lineage |
| Payload | Type-specific, variable, opaque to the framework |

The framework doesn't define what types mean. The type byte is a namespace — deployers define their own organism behavior and payload format.

## Covenant

The locking script (sCrypt) enforces:

- **Propagation** — output must recreate the same script
- **Generation** — counter increments by exactly 1 per reproduction
- **Budget** — balance decreases by reward + fee each generation
- **Reward** — claimer receives fixed sats
- **Death** — no continuation when balance < dust limit
- **Self-funding** — organism pays its own miner fees
- **Feeding** — balance can increase without reproduction (fund method)

## Receptor Primitives

Single-cell capabilities that the framework supports:

| Receptor | Description |
|----------|-------------|
| **Emit** | Write data to OP_RETURN payload |
| **Receive** | Accept external funding via `fund` (extends lifespan) |
| **Signal** | Include watchable data patterns in payload |
| **Tag** | Carry arbitrary data forward through generations |

What emerges when many organisms use these primitives together is not defined by the framework.

## CLI Tools

| Tool | Description |
|------|-------------|
| `wallet.cjs` | Create a wallet, show address, check balance |
| `spawn.cjs` | Deploy a new organism (`--type`, `--budget`, `--reward`, `--fee`) |
| `claim.cjs` | Trigger reproduction (`--txid`, `--address`) |
| `fund.cjs` | Feed an organism (`--txid`, `--amount`, `--wallet`) |
| `scanner.cjs` | Trace organism lineage (`--txid` or `--scan` for all) |

## Docs

- [Schema specification](docs/SCHEMA.md) — OP_RETURN format, transaction structure
- [Receptor primitives](docs/SCHEMA.md#receptor-primitives) — single-cell capabilities

## License

MIT
