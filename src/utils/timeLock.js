/**
 * Time-Lock / Proof-of-Work for VM startup.
 *
 * At transpile time a challenge seed is derived from a random key.
 * At runtime the VM must iterate a hash chain until the result
 * satisfies a difficulty target (top N bits zero). The solution
 * hash is then mixed into runtimeOpcodeState so skipping the
 * PoW silently corrupts dispatch.
 */

const DEFAULT_DIFFICULTY = 12;

function hashStep(state) {
    state = Math.imul(state ^ (state >>> 16), 0x45d9f3b) >>> 0;
    state = ((state << 13) | (state >>> 19)) >>> 0;
    state = Math.imul(state ^ (state >>> 16), 0x1bbcd9b5) >>> 0;
    return state;
}

function createTimeLockState(key) {
    const normalizedKey = String(key ?? "");
    let seed = 0x6a09e667;
    for (let i = 0; i < normalizedKey.length; i++) {
        seed = Math.imul((seed ^ normalizedKey.charCodeAt(i)) >>> 0, 0x5bd1e995) >>> 0;
    }
    return {
        challengeSeed: hashStep(seed),
        difficulty: DEFAULT_DIFFICULTY,
        solutionHash: 0,
    };
}

function solveTimeLock(state) {
    const { challengeSeed, difficulty } = state;
    const mask = (0xFFFFFFFF >>> (32 - difficulty)) << (32 - difficulty);
    let nonce = 0;
    let h = challengeSeed;
    while (true) {
        h = hashStep(Math.imul(challengeSeed ^ nonce, 0x5bd1e995) >>> 0);
        if ((h & mask) === 0) break;
        nonce = (nonce + 1) >>> 0;
        if (nonce > 0x00FFFFFF) nonce = (nonce * 3 + 7) >>> 0;
    }
    state.solutionHash = h;
    return h;
}

function verifyTimeLock(state) {
    return state.solutionHash !== 0;
}

module.exports = { createTimeLockState, solveTimeLock, verifyTimeLock, DEFAULT_DIFFICULTY };
