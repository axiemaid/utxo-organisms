#!/usr/bin/env node
// Trigger reproduction on a living UTXO organism
//
// Usage: node claim.cjs --txid <organism-txid> --address <your-bsv-address>

const fs = require('fs');
const path = require('path');
const https = require('https');
const { Organism } = require('./dist/src/contracts/organism');
const { bsv, PubKeyHash, toByteString, DefaultProvider, TestWallet } = require('scrypt-ts');

const ARTIFACT_PATH = path.join(__dirname, 'artifacts/organism.json');

// Parse args
const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
}

const TXID = args.txid;
const ADDRESS = args.address;

if (!TXID || !ADDRESS) {
  console.log('Usage: node claim.cjs --txid <organism-txid> --address <your-bsv-address>');
  process.exit(1);
}

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

function wocGetRaw(endpoint) {
  return new Promise((resolve, reject) => {
    https.get(`https://api.whatsonchain.com/v1/bsv/main${endpoint}`, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(d.trim()));
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

async function claim() {
  console.log('🧬 UTXO Organism — Reproduce');
  console.log(`   Organism: ${TXID.slice(0, 16)}...`);
  console.log(`   Claimer:  ${ADDRESS}`);
  console.log();

  // Validate address
  let addr;
  try {
    addr = bsv.Address.fromString(ADDRESS);
  } catch {
    console.error('❌ Invalid BSV address');
    process.exit(1);
  }

  // Load artifact
  Organism.loadArtifact(require(ARTIFACT_PATH));

  // Check if UTXO is still unspent
  const spentInfo = await wocGet(`/tx/${TXID}/0/spent`).catch(() => null);
  if (spentInfo && spentInfo.txid) {
    console.error(`❌ This organism UTXO has already been spent.`);
    console.error(`   Next generation: ${spentInfo.txid}`);
    console.error(`   Try claiming that one instead.`);
    process.exit(1);
  }

  // Fetch organism transaction
  const txHex = await wocGetRaw(`/tx/${TXID}/hex`);
  const bsvTx = new bsv.Transaction(txHex);

  // Reconstruct organism from tx
  const dummyKey = bsv.PrivateKey.fromRandom('mainnet');
  const provider = new DefaultProvider({ network: bsv.Networks.mainnet });
  const signer = new TestWallet(dummyKey, provider);
  await provider.connect();

  const organism = Organism.fromTx(bsvTx, 0);
  await organism.connect(signer);

  const currentBalance = BigInt(organism.balance);
  const reward = organism.reward;
  const fee = organism.fee;
  const nextBalance = currentBalance - reward - fee;
  const alive = nextBalance >= organism.dustLimit;
  const gen = Number(organism.generation);

  console.log(`   Generation: ${gen} → ${gen + 1}`);
  console.log(`   Balance:    ${currentBalance} → ${Number(nextBalance)} sats`);
  console.log(`   Reward:     ${Number(reward)} sats`);
  console.log(`   Survives:   ${alive ? 'yes' : 'no — this is the final generation'}`);

  const claimerPkh = toByteString(addr.hashBuffer.toString('hex'));

  // Build next instance
  const nextInstance = organism.next();
  nextInstance.generation = organism.generation + 1n;

  // Custom tx builder
  organism.bindTxBuilder('claim', (current, options, claimerPkhArg) => {
    const unsignedTx = new bsv.Transaction();
    unsignedTx.addInput(current.buildContractInput());

    if (alive) {
      unsignedTx.addOutput(new bsv.Transaction.Output({
        script: nextInstance.lockingScript,
        satoshis: Number(nextBalance),
      }));
    }

    // OP_RETURN
    const genBytes = Buffer.alloc(4);
    genBytes.writeUInt32LE(gen + 1);
    const typeBytes = Buffer.alloc(1);
    typeBytes.writeUInt8(Number(organism.organismType));
    const spawnBytes = Buffer.from(organism.spawnTxid, 'hex');

    const opReturnScript = bsv.Script.buildSafeDataOut([
      Buffer.from('ORG1'),
      typeBytes,
      genBytes,
      spawnBytes,
    ]);
    unsignedTx.addOutput(new bsv.Transaction.Output({
      script: opReturnScript,
      satoshis: 0,
    }));

    // Reward to claimer
    unsignedTx.addOutput(new bsv.Transaction.Output({
      script: bsv.Script.buildPublicKeyHashOut(addr),
      satoshis: Number(reward),
    }));

    return Promise.resolve({
      tx: unsignedTx,
      atInputIndex: 0,
      nexts: alive
        ? [{ instance: nextInstance, atOutputIndex: 0, balance: Number(nextBalance) }]
        : [],
    });
  });

  console.log('   Building transaction...');

  const callResult = await organism.methods.claim(
    PubKeyHash(claimerPkh),
    { autoPayFee: false, partiallySigned: true, estimateFee: false }
  );

  const txhex = callResult.tx.uncheckedSerialize();
  console.log(`   TX size: ${txhex.length / 2} bytes`);
  console.log('   Broadcasting...');

  const txid = await wocBroadcast(txhex);

  console.log();
  console.log('═══════════════════════════════════════════════');
  console.log(`   ⚡ Generation ${gen + 1} born!`);
  console.log(`   TXID:    ${txid}`);
  console.log(`   Reward:  ${Number(reward)} sats → ${ADDRESS}`);
  console.log(`   Balance: ${Number(nextBalance)} sats remaining`);
  if (!alive) console.log(`   💀 Organism has died.`);
  console.log(`   https://whatsonchain.com/tx/${txid}`);
  console.log('═══════════════════════════════════════════════');
}

claim().catch(err => {
  console.error('❌', err.message);
  process.exit(1);
});
