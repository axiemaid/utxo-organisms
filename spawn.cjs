#!/usr/bin/env node
// Spawn a new UTXO organism on BSV mainnet
//
// Usage: node spawn.cjs [options]
//   --type <n>      Organism type (default: 0 = heartbeat)
//   --budget <sats> Initial funding in satoshis (default: 100000)
//   --reward <sats> Reward per generation (default: 1000)
//   --fee <sats>    Miner fee per generation (default: 3000)
//   --wallet <path> Path to wallet.json (default: ./wallet.json)

const fs = require('fs');
const path = require('path');
const https = require('https');
const { Organism } = require('./dist/src/contracts/organism');
const { bsv, toByteString } = require('scrypt-ts');

// Parse args
const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
}

const TYPE = parseInt(args.type || '0');
const BUDGET = parseInt(args.budget || '100000');
const REWARD = parseInt(args.reward || '1000');
const FEE = parseInt(args.fee || '3000');
const DUST_LIMIT = 546;
const WALLET_PATH = args.wallet || path.join(__dirname, 'wallet.json');
const ARTIFACT_PATH = path.join(__dirname, 'artifacts/organism.json');

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
        catch { reject(new Error(`Bad JSON: ${d.slice(0, 200)}`)); }
      });
    }).on('error', reject);
  });
}

function wocBroadcast(txhex) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ txhex });
    const req = https.request({
      hostname: 'api.whatsonchain.com',
      path: '/v1/bsv/main/tx/raw',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        if (res.statusCode !== 200) reject(new Error(`Broadcast failed (${res.statusCode}): ${d}`));
        else resolve(d.replace(/"/g, '').trim());
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function spawn() {
  console.log('🧬 UTXO Organism Spawner');
  console.log(`   Type:   ${TYPE}`);
  console.log(`   Budget: ${BUDGET} sats`);
  console.log(`   Reward: ${REWARD} sats/gen`);
  console.log(`   Fee:    ${FEE} sats/gen`);
  const maxGens = Math.floor((BUDGET - DUST_LIMIT) / (REWARD + FEE));
  console.log(`   ~${maxGens} generations possible`);
  console.log();

  // Load wallet
  if (!fs.existsSync(WALLET_PATH)) {
    console.error(`❌ Wallet not found: ${WALLET_PATH}`);
    console.error('   Run: node wallet.cjs create');
    process.exit(1);
  }
  const wallet = JSON.parse(fs.readFileSync(WALLET_PATH, 'utf-8'));
  const privateKey = bsv.PrivateKey.fromWIF(wallet.wif);
  const fundingAddress = privateKey.toAddress();
  console.log(`   Funding: ${fundingAddress.toString()}`);

  // Load artifact
  Organism.loadArtifact(require(ARTIFACT_PATH));

  // Placeholder spawnTxid (32 zero bytes) — gen 0 doesn't know its own txid
  const zeroTxid = toByteString('0000000000000000000000000000000000000000000000000000000000000000');

  // Create organism instance
  const organism = new Organism(
    BigInt(TYPE),
    BigInt(REWARD),
    BigInt(FEE),
    BigInt(DUST_LIMIT),
    zeroTxid,
    0n  // generation 0
  );

  // Fetch UTXOs from funding address
  console.log('   Fetching UTXOs...');
  const utxos = await wocGet(`/address/${fundingAddress.toString()}/unspent`);
  if (!utxos || utxos.length === 0) {
    console.error(`❌ No UTXOs at ${fundingAddress.toString()}`);
    console.error('   Send BSV to this address first.');
    process.exit(1);
  }

  const totalAvailable = utxos.reduce((s, u) => s + u.value, 0);
  console.log(`   Available: ${totalAvailable} sats (${utxos.length} UTXOs)`);

  // Need budget + spawn tx fee
  const SPAWN_FEE = 3000; // fee for the spawn tx itself
  const needed = BUDGET + SPAWN_FEE;
  if (totalAvailable < needed) {
    console.error(`❌ Need ${needed} sats, only ${totalAvailable} available`);
    process.exit(1);
  }

  // Build spawn transaction manually
  const tx = new bsv.Transaction();

  // Add inputs
  for (const utxo of utxos) {
    tx.from({
      txId: utxo.tx_hash,
      outputIndex: utxo.tx_pos,
      script: bsv.Script.buildPublicKeyHashOut(fundingAddress).toHex(),
      satoshis: utxo.value,
    });
  }

  // Output 0: organism UTXO
  tx.addOutput(new bsv.Transaction.Output({
    script: organism.lockingScript,
    satoshis: BUDGET,
  }));

  // Output 1: OP_RETURN with ORG1 data (gen 0)
  const genBytes = Buffer.alloc(4);
  genBytes.writeUInt32LE(0);
  const typeBytes = Buffer.alloc(1);
  typeBytes.writeUInt8(TYPE);
  const spawnTxidBytes = Buffer.alloc(32, 0); // zeros at gen 0

  const opReturnScript = bsv.Script.buildSafeDataOut([
    Buffer.from('ORG1'),
    typeBytes,
    genBytes,
    spawnTxidBytes,
  ]);
  tx.addOutput(new bsv.Transaction.Output({
    script: opReturnScript,
    satoshis: 0,
  }));

  // Change output
  const change = totalAvailable - BUDGET - SPAWN_FEE;
  if (change > DUST_LIMIT) {
    tx.addOutput(new bsv.Transaction.Output({
      script: bsv.Script.buildPublicKeyHashOut(fundingAddress),
      satoshis: change,
    }));
  }

  // Sign
  tx.sign(privateKey);

  const txhex = tx.serialize();
  console.log(`   TX size: ${txhex.length / 2} bytes`);
  console.log('   Broadcasting...');

  const txid = await wocBroadcast(txhex);

  console.log();
  console.log('═══════════════════════════════════════════════');
  console.log(`   🥚 Organism spawned!`);
  console.log(`   TXID: ${txid}`);
  console.log(`   Type: ${TYPE}`);
  console.log(`   Budget: ${BUDGET} sats`);
  console.log(`   ~${maxGens} generations`);
  console.log(`   https://whatsonchain.com/tx/${txid}`);
  console.log('═══════════════════════════════════════════════');

  // Save state
  const statePath = path.join(__dirname, 'organisms', `${txid.slice(0, 16)}.json`);
  fs.mkdirSync(path.join(__dirname, 'organisms'), { recursive: true });
  const state = {
    spawnTxid: txid,
    type: TYPE,
    reward: REWARD,
    fee: FEE,
    dustLimit: DUST_LIMIT,
    budget: BUDGET,
    generation: 0,
    currentTxid: txid,
    currentOutputIndex: 0,
    spawnedAt: new Date().toISOString(),
  };
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  console.log(`   State: ${statePath}`);
}

spawn().catch(err => {
  console.error('❌', err.message);
  process.exit(1);
});
