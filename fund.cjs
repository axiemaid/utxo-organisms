#!/usr/bin/env node
// Feed a living UTXO organism — increase its balance without triggering reproduction
//
// Usage: node fund.cjs --txid <organism-txid> --amount <sats> --wallet <path>

const fs = require('fs');
const path = require('path');
const https = require('https');
const { Organism } = require('./dist/src/contracts/organism');
const { bsv, toByteString, PubKeyHash, DefaultProvider, TestWallet } = require('scrypt-ts');

const ARTIFACT_PATH = path.join(__dirname, 'artifacts/organism.json');

// Parse args
const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
}

const TXID = args.txid;
const AMOUNT = parseInt(args.amount || '0');
const WALLET_PATH = args.wallet || path.join(__dirname, 'wallet.json');
const FEE = parseInt(args.fee || '3000');

if (!TXID || !AMOUNT) {
  console.log('Usage: node fund.cjs --txid <organism-txid> --amount <sats> --wallet <path>');
  console.log('');
  console.log('Options:');
  console.log('  --txid <txid>    Current organism transaction ID');
  console.log('  --amount <sats>  Sats to add to the organism balance');
  console.log('  --wallet <path>  Path to wallet.json (default: ./wallet.json)');
  console.log('  --fee <sats>     Miner fee for the fund tx (default: 3000)');
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

async function fund() {
  console.log('🧬 UTXO Organism — Feed');
  console.log(`   Organism: ${TXID.slice(0, 16)}...`);
  console.log(`   Adding:   ${AMOUNT} sats`);
  console.log();

  // Load wallet
  if (!fs.existsSync(WALLET_PATH)) {
    console.error(`❌ Wallet not found: ${WALLET_PATH}`);
    process.exit(1);
  }
  const wallet = JSON.parse(fs.readFileSync(WALLET_PATH, 'utf-8'));
  const privateKey = bsv.PrivateKey.fromWIF(wallet.wif);
  const fundingAddress = privateKey.toAddress();

  // Load artifact
  Organism.loadArtifact(require(ARTIFACT_PATH));

  // Check if UTXO is still unspent
  const spentInfo = await wocGet(`/tx/${TXID}/0/spent`).catch(() => null);
  if (spentInfo && spentInfo.txid) {
    console.error(`❌ This organism UTXO has already been spent.`);
    console.error(`   Next: ${spentInfo.txid}`);
    process.exit(1);
  }

  // Fetch organism tx
  const txHex = await wocGetRaw(`/tx/${TXID}/hex`);
  const bsvTx = new bsv.Transaction(txHex);

  // Reconstruct organism
  const dummyKey = bsv.PrivateKey.fromRandom('mainnet');
  const provider = new DefaultProvider({ network: bsv.Networks.mainnet });
  const signer = new TestWallet(dummyKey, provider);
  await provider.connect();

  const organism = Organism.fromTx(bsvTx, 0);
  await organism.connect(signer);

  const currentBalance = Number(organism.balance);
  const newBalance = currentBalance + AMOUNT;
  const gen = Number(organism.generation);

  console.log(`   Current balance: ${currentBalance} sats`);
  console.log(`   New balance:     ${newBalance} sats`);

  const oldGensLeft = Math.floor((currentBalance - 546) / (Number(organism.reward) + Number(organism.fee)));
  const newGensLeft = Math.floor((newBalance - 546) / (Number(organism.reward) + Number(organism.fee)));
  console.log(`   Generations:     ${oldGensLeft} → ${newGensLeft} (+${newGensLeft - oldGensLeft})`);

  // Fetch funder UTXOs
  const utxos = await wocGet(`/address/${fundingAddress.toString()}/unspent`);
  if (!utxos || utxos.length === 0) {
    console.error(`❌ No UTXOs at ${fundingAddress.toString()}`);
    process.exit(1);
  }

  const totalAvailable = utxos.reduce((s, u) => s + u.value, 0);
  const needed = AMOUNT + FEE;
  if (totalAvailable < needed) {
    console.error(`❌ Need ${needed} sats, only ${totalAvailable} available`);
    process.exit(1);
  }

  // Build next instance (same generation, same state)
  const nextInstance = organism.next();
  // generation stays the same — no increment for fund

  // Custom tx builder
  organism.bindTxBuilder('fund', (current, options, newBalanceArg) => {
    const unsignedTx = new bsv.Transaction();

    // Input 0: organism UTXO
    unsignedTx.addInput(current.buildContractInput());

    // Funding inputs
    for (const utxo of utxos) {
      unsignedTx.from({
        txId: utxo.tx_hash,
        outputIndex: utxo.tx_pos,
        script: bsv.Script.buildPublicKeyHashOut(fundingAddress).toHex(),
        satoshis: utxo.value,
      });
    }

    // Output 0: organism with increased balance
    unsignedTx.addOutput(new bsv.Transaction.Output({
      script: nextInstance.lockingScript,
      satoshis: newBalance,
    }));

    // Output 1: OP_RETURN (same gen, no change)
    const genBytes = Buffer.alloc(4);
    genBytes.writeUInt32LE(gen);
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

    // Change back to funder
    if (hasChange) {
      unsignedTx.addOutput(new bsv.Transaction.Output({
        script: bsv.Script.buildPublicKeyHashOut(fundingAddress),
        satoshis: changeForContract,
      }));
    }

    return Promise.resolve({
      tx: unsignedTx,
      atInputIndex: 0,
      nexts: [{ instance: nextInstance, atOutputIndex: 0, balance: newBalance }],
    });
  });

  console.log('   Building transaction...');

  // Compute change for contract params
  const totalIn = currentBalance + totalAvailable;
  const changeForContract = totalIn - newBalance - FEE;
  const hasChange = changeForContract > 546;
  const changePkh = toByteString(fundingAddress.hashBuffer.toString('hex'));

  const callResult = await organism.methods.fund(
    BigInt(newBalance),
    PubKeyHash(changePkh),
    BigInt(hasChange ? changeForContract : 0),
    { autoPayFee: false, partiallySigned: true, estimateFee: false }
  );

  // Sign the funding inputs (input 0 is contract, inputs 1+ are P2PKH)
  const tx = callResult.tx;
  for (let i = 1; i < tx.inputs.length; i++) {
    const sig = bsv.Transaction.Sighash.sign(
      tx, privateKey, 0x41,
      i, tx.inputs[i].output.script, tx.inputs[i].output.satoshisBN
    );
    tx.inputs[i].setScript(
      bsv.Script.buildPublicKeyHashIn(privateKey.toPublicKey(), sig)
    );
  }

  const txhex = tx.uncheckedSerialize();
  console.log(`   TX size: ${txhex.length / 2} bytes`);
  console.log('   Broadcasting...');

  const txid = await wocBroadcast(txhex);

  console.log();
  console.log('═══════════════════════════════════════════════');
  console.log(`   🍖 Organism fed!`);
  console.log(`   TXID:    ${txid}`);
  console.log(`   Balance: ${currentBalance} → ${newBalance} sats`);
  console.log(`   Gens:    ${oldGensLeft} → ${newGensLeft}`);
  console.log(`   https://whatsonchain.com/tx/${txid}`);
  console.log('═══════════════════════════════════════════════');
}

fund().catch(err => {
  console.error('❌', err.message);
  process.exit(1);
});
