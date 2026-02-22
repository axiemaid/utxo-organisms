import {
    assert,
    ByteString,
    hash256,
    int2ByteString,
    method,
    prop,
    PubKeyHash,
    SmartContract,
    toByteString,
    Utils,
} from 'scrypt-ts'

/**
 * UTXO Organism — Base Covenant Template (ORG1 Protocol)
 *
 * A self-replicating, self-funding UTXO covenant on BSV.
 * Each spend ("reproduction") enforces:
 *   - Output 0: organism continuation (same script, decremented balance, incremented generation)
 *   - Output 1: OP_RETURN with ORG1 protocol data
 *   - Output 2: reward payment to claimer
 *   - Miner fee paid from organism's own balance
 *
 * When balance drops below dust, the organism dies (no continuation output).
 *
 * OP_RETURN schema:
 *   OP_FALSE OP_RETURN "ORG1" <type:1B> <generation:4B LE> <spawnTxid:32B>
 */
export class Organism extends SmartContract {
    // Organism type identifier (0 = heartbeat, 1 = task, etc.)
    @prop()
    organismType: bigint

    // Reward in satoshis paid to claimer per generation
    @prop()
    reward: bigint

    // Fixed miner fee deducted from balance per generation
    @prop()
    fee: bigint

    // Minimum balance to stay alive
    @prop()
    dustLimit: bigint

    // Spawn transaction ID (32 bytes) — links all generations of one lineage
    @prop()
    spawnTxid: ByteString

    // Generation counter (stateful — increments each reproduction)
    @prop(true)
    generation: bigint

    constructor(
        organismType: bigint,
        reward: bigint,
        fee: bigint,
        dustLimit: bigint,
        spawnTxid: ByteString,
        generation: bigint
    ) {
        super(...arguments)
        this.organismType = organismType
        this.reward = reward
        this.fee = fee
        this.dustLimit = dustLimit
        this.spawnTxid = spawnTxid
        this.generation = generation
    }

    @method()
    public claim(claimerPkh: PubKeyHash) {
        const currentBalance: bigint = this.ctx.utxo.value
        const nextBalance: bigint = currentBalance - this.reward - this.fee

        // Increment generation
        this.generation++

        let outputs: ByteString = toByteString('')

        const alive: boolean = nextBalance >= this.dustLimit

        if (alive) {
            // Output 0: organism continuation (same script, reduced balance)
            outputs = this.buildStateOutput(nextBalance)
        }

        // OP_RETURN: ORG1 protocol data
        // Format: OP_FALSE OP_RETURN <4:"ORG1"> <1:type> <4:generation LE> <32:spawnTxid>
        const opReturnScript: ByteString =
            toByteString('006a') +              // OP_FALSE OP_RETURN
            toByteString('04') +                // pushdata 4 bytes
            toByteString('4f524731') +           // "ORG1" in hex
            toByteString('01') +                // pushdata 1 byte
            int2ByteString(this.organismType, 1n) +
            toByteString('04') +                // pushdata 4 bytes
            int2ByteString(this.generation, 4n) +  // generation LE
            toByteString('20') +                // pushdata 32 bytes
            this.spawnTxid                       // spawn txid

        outputs += Utils.buildOutput(opReturnScript, 0n)

        // Reward output to claimer
        outputs += Utils.buildPublicKeyHashOutput(claimerPkh, this.reward)

        assert(
            this.ctx.hashOutputs == hash256(outputs),
            'hashOutputs mismatch'
        )
    }
}
