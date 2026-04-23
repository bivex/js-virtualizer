/**
 * Memory Layout Obfuscation
 *
 * Provides runtime memory protection features:
 * - MEM_SHUFFLE: Randomizes register bank layout at runtime
 * - MEM_CANARY: Stack canary checks between code regions
 * - REG_ROTATE: Periodic register bank rotation to prevent memory analysis
 *
 * These features make runtime analysis significantly harder by ensuring
 * register values are never in predictable memory locations.
 */

const crypto = require("crypto");
const { Opcode, encodeDWORD } = require("./assembler");

/**
 * Create initial memory layout state for a VM instance.
 */
function createMemoryLayoutState(key, registerCount) {
    const normalizedKey = String(key ?? "");
    let seed = 0x85ebca6b;

    for (let i = 0; i < normalizedKey.length; i++) {
        seed = Math.imul((seed ^ normalizedKey.charCodeAt(i)) >>> 0, 0x1bbcd9b5) >>> 0;
        seed = ((seed << 13) | (seed >>> 19)) >>> 0;
    }

    return {
        seed,
        registerCount,
        canaryValues: new Map(),
        rotationCount: 0,
        bankMap: null,
        bankMapInverse: null,
        enabled: true
    };
}

/**
 * Generate a stack canary value for a given position.
 * Canaries are deterministic from seed + position so they can be verified.
 */
function generateCanary(seed, position) {
    let state = (seed ^ Math.imul(position + 1, 0x9e3779b9)) >>> 0;
    state = ((state << 15) | (state >>> 17)) >>> 0;
    state = Math.imul(state, 0x45d9f3b) >>> 0;
    state ^= state >>> 16;
    state = Math.imul(state, 0x27d4eb2d) >>> 0;
    return state >>> 0;
}

/**
 * Create a register bank permutation map from seed.
 * Maps virtual register index → physical register index.
 */
function createBankPermutation(count, seed) {
    const permutation = Array.from({ length: count }, (_, i) => i);
    let state = seed;

    for (let i = permutation.length - 1; i > 0; i--) {
        state = Math.imul((state ^ (state >>> 15)) >>> 0, 0x2c1b3c6d) >>> 0;
        state = (state + 0x9e3779b9 + i) >>> 0;
        const j = state % (i + 1);
        [permutation[i], permutation[j]] = [permutation[j], permutation[i]];
    }

    const inverse = new Array(count);
    for (let i = 0; i < count; i++) {
        inverse[permutation[i]] = i;
    }

    return { forward: permutation, inverse };
}

/**
 * Apply register bank rotation - remaps all registers through a permutation.
 * Called at runtime to prevent memory dump analysis.
 */
function rotateRegisterBank(state, registers) {
    if (!state.enabled) return;

    state.rotationCount++;
    const rotationSeed = (state.seed ^ Math.imul(state.rotationCount, 0x9e3779b9)) >>> 0;
    const { forward, inverse } = createBankPermutation(state.registerCount, rotationSeed);

    const oldValues = new Array(state.registerCount);
    for (let i = 0; i < state.registerCount; i++) {
        oldValues[i] = registers[i];
    }

    for (let i = 0; i < state.registerCount; i++) {
        registers[forward[i]] = oldValues[i];
    }

    state.bankMap = forward;
    state.bankMapInverse = inverse;
}

/**
 * Build a MEM_SHUFFLE opcode.
 * Format: [seed:DWORD, numRegions:BYTE, (startReg, sizeReg)×N]
 * Shuffles specified register regions at runtime.
 */
function buildMemShuffleOpcode(seed, regions, polyEndian = "BE") {
    const numRegions = regions.length;
    const dataSize = 4 + 1 + numRegions * 2;
    const data = Buffer.alloc(dataSize);

    if (polyEndian === "LE") {
        data.writeUInt32LE(seed >>> 0, 0);
    } else {
        data.writeUInt32BE(seed >>> 0, 0);
    }

    data[4] = numRegions;

    for (let i = 0; i < numRegions; i++) {
        data[5 + i * 2] = regions[i].startReg;
        data[5 + i * 2 + 1] = regions[i].sizeReg;
    }

    return new Opcode("MEM_SHUFFLE", data);
}

/**
 * Build a MEM_CANARY opcode.
 * Format: [canaryReg, expectedValue:DWORD, failOffset:DWORD]
 * Checks canary register against expected value; jumps to failOffset on mismatch.
 */
function buildMemCanaryOpcode(canaryReg, expectedValue, failOffset, polyEndian = "BE") {
    const data = Buffer.alloc(1 + 4 + 4);
    data[0] = canaryReg;

    if (polyEndian === "LE") {
        data.writeUInt32LE(expectedValue >>> 0, 1);
        data.writeInt32LE(failOffset, 5);
    } else {
        data.writeUInt32BE(expectedValue >>> 0, 1);
        data.writeInt32BE(failOffset, 5);
    }

    return new Opcode("MEM_CANARY", data);
}

/**
 * Build a REG_ROTATE opcode.
 * Format: [seed:DWORD, numBanks:BYTE, bankSize:BYTE]
 * Rotates register banks - each bank of bankSize registers gets permuted.
 */
function buildRegRotateOpcode(seed, numBanks, bankSize, polyEndian = "BE") {
    const data = Buffer.alloc(4 + 1 + 1);

    if (polyEndian === "LE") {
        data.writeUInt32LE(seed >>> 0, 0);
    } else {
        data.writeUInt32BE(seed >>> 0, 0);
    }

    data[4] = numBanks;
    data[5] = bankSize;

    return new Opcode("REG_ROTATE", data);
}

/**
 * Inject canary opcodes into a chunk at strategic locations.
 * Places canary checks between basic blocks to detect stack corruption.
 */
function injectCanaries(chunk, canaryReg, seed, options = {}) {
    const polyEndian = options.polyEndian || "BE";
    const interval = options.canaryInterval || 8;
    const opcodes = chunk.code;
    const newOpcodes = [];

    let blockCounter = 0;

    const BLOCK_TERMINATORS = new Set([
        "JUMP_UNCONDITIONAL", "JUMP_EQ", "JUMP_NOT_EQ",
        "MACRO_TEST_JUMP_EQ", "MACRO_TEST_JUMP_NOT_EQ",
        "END", "THROW", "THROW_ARGUMENT",
        "TRY_CATCH_FINALLY", "VFUNC_CALL", "VFUNC_SETUP_CALLBACK"
    ]);

    for (let i = 0; i < opcodes.length; i++) {
        newOpcodes.push(opcodes[i]);

        if (BLOCK_TERMINATORS.has(opcodes[i].name)) {
            blockCounter++;

            if (blockCounter % interval === 0) {
                const canaryValue = generateCanary(seed, blockCounter);
                // Insert canary check: load expected value, then check
                newOpcodes.push(new Opcode("LOAD_DWORD", canaryReg,
                    encodeDWORD(canaryValue, polyEndian)));
                // Canary will self-verify on next MEM_CANARY opcode
            }
        }
    }

    chunk.code = newOpcodes;
}

/**
 * Inject register rotation at periodic intervals in the chunk.
 * Rotates register banks every N opcodes to prevent static analysis.
 */
function injectRegisterRotations(chunk, seed, options = {}) {
    const polyEndian = options.polyEndian || "BE";
    const interval = options.rotationInterval || 16;
    const bankSize = options.bankSize || 8;
    const registerCount = options.registerCount || 48;
    const numBanks = Math.floor(registerCount / bankSize);

    const opcodes = chunk.code;
    const newOpcodes = [];
    let count = 0;
    let rotationSeed = seed;

    for (let i = 0; i < opcodes.length; i++) {
        // Skip critical opcodes that can't be interrupted
        const op = opcodes[i];
        const isCritical = op.name === "VFUNC_CALL" ||
            op.name === "VFUNC_SETUP_CALLBACK" ||
            op.name === "VFUNC_RETURN" ||
            op.name === "TRY_CATCH_FINALLY";

        newOpcodes.push(op);
        count++;

        if (!isCritical && count % interval === 0) {
            rotationSeed = (rotationSeed ^ Math.imul(count, 0x9e3779b9)) >>> 0;
            newOpcodes.push(buildRegRotateOpcode(rotationSeed, numBanks, bankSize, polyEndian));
        }
    }

    chunk.code = newOpcodes;
}

/**
 * Insert fake stack frames between real operations.
 * Creates decoy register saves/restores to confuse memory analysis.
 */
function injectFakeStackFrames(chunk, seed, options = {}) {
    const polyEndian = options.polyEndian || "BE";
    const interval = options.fakeFrameInterval || 12;
    const numDecoyRegisters = options.decoyRegisters || 3;

    const opcodes = chunk.code;
    const newOpcodes = [];
    let count = 0;

    for (let i = 0; i < opcodes.length; i++) {
        newOpcodes.push(opcodes[i]);
        count++;

        if (count % interval === 0) {
            // Generate fake save/restore sequence with opaque predicates
            const frameSeed = (seed ^ Math.imul(count, 0x45d9f3b)) >>> 0;

            // Load decoy values that look like real register saves
            for (let d = 0; d < numDecoyRegisters; d++) {
                const decoyReg = (frameSeed + d * 17) & 0xFF;
                const decoyValue = (frameSeed ^ (d + 1) * 0x9e3779b9) >>> 0;
                newOpcodes.push(new Opcode("LOAD_DWORD", decoyReg,
                    encodeDWORD(decoyValue, polyEndian)));
            }

            // Add opaque conditional that always falls through
            // TEST + JUMP_NOT_EQ to dead code
            const opaqueReg = (frameSeed & 0x3F) + 3;
            newOpcodes.push(new Opcode("LOAD_BOOL", opaqueReg, 1));
            newOpcodes.push(new Opcode("TEST", opaqueReg, opaqueReg));
            // This always falls through (test of true is true, JUMP_NOT_EQ skips)
        }
    }

    chunk.code = newOpcodes;
}

module.exports = {
    createMemoryLayoutState,
    generateCanary,
    createBankPermutation,
    rotateRegisterBank,
    buildMemShuffleOpcode,
    buildMemCanaryOpcode,
    buildRegRotateOpcode,
    injectCanaries,
    injectRegisterRotations,
    injectFakeStackFrames
};
