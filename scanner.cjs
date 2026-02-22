#!/usr/bin/env node
// ORG1 Protocol Scanner — find and track all UTXO organisms on BSV
//
// Usage:
//   node scanner.cjs --txid <spawn-txid>       Trace one organism lineage
//   node scanner.cjs --scan                     Scan known organisms from organisms/ dir
//
// Reads OP_RETURN with ORG1 prefix, decodes common fields, traces lineage via output 0 spends.

const fs = require('fs');
const path = require('path');
const https = require('https');

const ORGANISMS_DIR = path.join(__dirname, 'organisms');
const LINEAGE_DIR = path.join(__dirname, 'lineage');

function wocGet(endpoint) {
  return new Promise((resolve, reject) => {
    https.get(`https://api.whatsonchain.com/v1/bsv/main${endpoint}`, {
      headers: { Accept: 'application/json' }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        if (res.statusCode === 404) return resolve(null);
        try { resolve(JSON.parse(d)); }
        catch { reject(new Error(`Bad JSON from ${endpoint}: ${d.slice(0, 200)}`)); }
      });
    }).on('error', reject);
  });
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// Decode ORG1 OP_RETURN from a transaction's outputs
function decodeORG1(tx) {
  for (const out of tx.vout) {
    const hex = out.scriptPubKey?.hex;
    if (!hex) continue;
    // Look for OP_FALSE OP_RETURN followed by push of "ORG1" (4f524731)
    // Pattern: 006a04 4f524731 ...
    const idx = hex.indexOf('4f524731');
    if (idx === -1) continue;
    const after = hex.slice(idx + 8); // after "ORG1"
    if (after.length < 2 + 2 + 8 + 2 + 64) continue; // minimum remaining

    // <01><type:1B> <04><gen:4B> <20><spawnTxid:32B>
    let pos = 0;
    // type
    const typePushLen = parseInt(after.slice(pos, pos + 2), 16); pos += 2;
    const type = parseInt(after.slice(pos, pos + typePushLen * 2), 16); pos += typePushLen * 2;
    // generation
    const genPushLen = parseInt(after.slice(pos, pos + 2), 16); pos += 2;
    const genHex = after.slice(pos, pos + genPushLen * 2); pos += genPushLen * 2;
    const genBuf = Buffer.from(genHex, 'hex');
    const generation = genBuf.readUInt32LE(0);
    // spawn txid
    const spawnPushLen = parseInt(after.slice(pos, pos + 2), 16); pos += 2;
    const spawnTxid = after.slice(pos, pos + spawnPushLen * 2); pos += spawnPushLen * 2;
    // remaining = type-specific payload
    const payload = after.slice(pos);

    return { type, generation, spawnTxid, payload };
  }
  return null;
}

// Get reward address from tx outputs
function getRewardAddress(tx, hasOrgOutput) {
  // Reward is the last P2PKH output
  for (let i = tx.vout.length - 1; i >= 0; i--) {
    const addr = tx.vout[i].scriptPubKey?.addresses?.[0];
    if (addr) return addr;
  }
  return 'unknown';
}

async function traceLineage(spawnTxid) {
  console.log(`🧬 Tracing organism: ${spawnTxid.slice(0, 16)}...`);

  // Check for cached lineage
  fs.mkdirSync(LINEAGE_DIR, { recursive: true });
  const lineagePath = path.join(LINEAGE_DIR, `${spawnTxid.slice(0, 16)}.json`);
  let lineage = [];
  let startTxid = spawnTxid;
  let startGen = 0;

  try {
    const existing = JSON.parse(fs.readFileSync(lineagePath, 'utf-8'));
    if (existing.length > 0) {
      const last = existing[existing.length - 1];
      if (last.spentBy) {
        lineage = existing;
        startTxid = last.spentBy;
        startGen = last.generation + 1;
        console.log(`  📂 Resuming from Gen ${startGen} (${lineage.length} cached)`);
      } else if (last.alive) {
        lineage = existing.slice(0, -1);
        startTxid = last.txid;
        startGen = last.generation;
        console.log(`  📂 Re-checking Gen ${startGen}`);
      }
    }
  } catch {}

  let currentTxid = startTxid;
  let generation = startGen;

  while (currentTxid) {
    await delay(300);
    const tx = await wocGet(`/tx/${currentTxid}`);
    if (!tx) {
      console.error(`  ❌ Could not fetch tx ${currentTxid}`);
      break;
    }

    const isSpawn = generation === 0;
    const organismOutput = tx.vout[0];
    const balance = Math.round(organismOutput.value * 1e8);
    const blockHeight = tx.blockheight || null;
    const blockTime = tx.blocktime ? new Date(tx.blocktime * 1000).toISOString() : null;
    const claimer = isSpawn ? 'spawn' : getRewardAddress(tx);

    // Decode ORG1 data if present
    const org1 = decodeORG1(tx);

    // Calculate reward (sum of P2PKH outputs after organism output)
    let rewardSats = 0;
    if (!isSpawn) {
      for (let i = 1; i < tx.vout.length; i++) {
        if (tx.vout[i].value > 0 && tx.vout[i].scriptPubKey?.addresses) {
          rewardSats += Math.round(tx.vout[i].value * 1e8);
        }
      }
    }

    const prevBalance = generation > 0 && lineage[generation - 1]
      ? lineage[generation - 1].balance : null;
    const feePaid = prevBalance !== null ? prevBalance - balance - rewardSats : 0;

    const entry = {
      generation,
      txid: currentTxid,
      balance,
      claimer,
      reward: rewardSats,
      fee: feePaid,
      blockHeight,
      blockTime,
      alive: true,
      org1: org1 || null,
    };

    const tag = isSpawn ? '🥚 spawn' : `⚡ ${claimer.slice(0, 16)}...`;
    const typeStr = org1 ? ` [type:${org1.type}]` : '';
    console.log(
      `  Gen ${String(generation).padStart(3)}: ` +
      `${currentTxid.slice(0, 16)}... | ` +
      `${String(balance).padStart(7)} sats | ` +
      `${tag}${typeStr}` +
      (rewardSats ? ` | +${rewardSats}` : '') +
      ` | ${blockTime ? blockTime.slice(0, 19) : 'mempool'}`
    );

    // Check if output 0 has been spent
    await delay(300);
    let spentInfo = null;
    try {
      spentInfo = await wocGet(`/tx/${currentTxid}/0/spent`);
    } catch {}

    if (spentInfo && spentInfo.txid) {
      entry.alive = false;
      entry.spentBy = spentInfo.txid;
      lineage.push(entry);
      currentTxid = spentInfo.txid;
      generation++;
    } else {
      lineage.push(entry);
      currentTxid = null;
    }
  }

  // Save lineage
  fs.writeFileSync(lineagePath, JSON.stringify(lineage, null, 2));

  // Summary
  const living = lineage[lineage.length - 1];
  const totalClaims = lineage.filter(e => e.generation > 0).length;
  const uniqueClaimers = new Set(lineage.filter(e => e.claimer !== 'spawn').map(e => e.claimer));

  console.log();
  console.log('═══════════════════════════════════════════════');
  if (living.alive) {
    console.log(`  🧬 ALIVE at Gen ${living.generation} | ${living.balance} sats`);
  } else {
    console.log(`  💀 DEAD at Gen ${living.generation}`);
  }
  console.log(`  📊 ${totalClaims} claims | ${uniqueClaimers.size} unique participants`);
  console.log(`  📄 ${lineagePath}`);
  console.log('═══════════════════════════════════════════════');

  return lineage;
}

async function scanAll() {
  fs.mkdirSync(ORGANISMS_DIR, { recursive: true });
  const files = fs.readdirSync(ORGANISMS_DIR).filter(f => f.endsWith('.json'));
  if (files.length === 0) {
    console.log('No organisms found. Spawn one first: node spawn.cjs');
    return;
  }

  console.log(`🔍 Scanning ${files.length} organism(s)...\n`);

  for (const file of files) {
    const state = JSON.parse(fs.readFileSync(path.join(ORGANISMS_DIR, file), 'utf-8'));
    await traceLineage(state.spawnTxid);
    console.log();
  }
}

// CLI
const cmd = process.argv[2];
if (cmd === '--txid' && process.argv[3]) {
  traceLineage(process.argv[3]).catch(err => {
    console.error('❌', err.message);
    process.exit(1);
  });
} else if (cmd === '--scan' || !cmd) {
  scanAll().catch(err => {
    console.error('❌', err.message);
    process.exit(1);
  });
} else {
  console.log('Usage:');
  console.log('  node scanner.cjs                     Scan all known organisms');
  console.log('  node scanner.cjs --txid <spawn-txid>  Trace one organism');
}
