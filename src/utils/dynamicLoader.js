/**
 * Dynamic Code Loading
 *
 * Enables runtime bytecode generation, loading, and execution.
 * - DYN_LOAD: Decrypt and load bytecode from a register into an internal buffer
 * - DYN_EXEC: Execute loaded bytecode from a given entry offset
 * - DYN_PATCH: Hot-patch the running bytecode at runtime
 *
 * XOR-based encryption with seeded key derivation.
 */

const crypto = require("crypto");
const { Opcode, VMChunk, encodeDWORD } = require("./assembler");

/**
 * Encrypt bytecode payload with a key using position-dependent XOR.
 * @param {Buffer} bytecode
 * @param {string|number} key
 * @returns {{ encrypted: Buffer, keySeed: number }}
 */
function encryptBytecode(bytecode, key) {
    const keySeed = deriveBytecodeKey(key);
    const encrypted = Buffer.alloc(bytecode.length);

    for (let i = 0; i < bytecode.length; i++) {
        const mask = byteMask(keySeed, i);
        encrypted[i] = bytecode[i] ^ mask;
    }

    return { encrypted, keySeed };
}

/**
 * Decrypt bytecode payload (inverse of encryptBytecode).
 * @param {Buffer} encrypted
 * @param {number} keySeed
 * @returns {Buffer}
 */
function decryptBytecode(encrypted, keySeed) {
    const decrypted = Buffer.alloc(encrypted.length);

    for (let i = 0; i < encrypted.length; i++) {
        const mask = byteMask(keySeed, i);
        decrypted[i] = encrypted[i] ^ mask;
    }

    return decrypted;
}

function deriveBytecodeKey(key) {
    const input = String(key);
    let seed = 0x9e3779b9;

    for (let i = 0; i < input.length; i++) {
        seed = Math.imul((seed ^ input.charCodeAt(i)) >>> 0, 0x5bd1e995) >>> 0;
        seed = ((seed << 13) | (seed >>> 19)) >>> 0;
    }

    return seed >>> 0;
}

function byteMask(seed, position) {
    let state = (seed ^ Math.imul(position + 1, 0x27d4eb2d)) >>> 0;
    state = ((state << 15) | (state >>> 17)) >>> 0;
    state = Math.imul(state ^ (state >>> 15), 0x45d9f3b) >>> 0;
    return state & 0xFF;
}

/**
 * Build a DYN_LOAD opcode.
 * Format: [srcReg, keySeed:DWORD, bytecodeLength:DWORD]
 * The src register must contain the encrypted bytecode as Uint8Array.
 */
function buildDynLoadOpcode(srcReg, keySeed, bytecodeLength, polyEndian = "BE") {
    const data = Buffer.alloc(1 + 4 + 4);
    data[0] = srcReg;

    if (polyEndian === "LE") {
        data.writeUInt32LE(keySeed >>> 0, 1);
        data.writeUInt32LE(bytecodeLength, 5);
    } else {
        data.writeUInt32BE(keySeed >>> 0, 1);
        data.writeUInt32BE(bytecodeLength, 5);
    }

    return new Opcode("DYN_LOAD", data);
}

/**
 * Build a DYN_EXEC opcode.
 * Format: [entryOffset:DWORD]
 * Executes the dynamically loaded bytecode starting at entryOffset.
 */
function buildDynExecOpcode(entryOffset, polyEndian = "BE") {
    const data = encodeDWORD(entryOffset, polyEndian);
    return new Opcode("DYN_EXEC", data);
}

/**
 * Build a DYN_PATCH opcode.
 * Format: [srcReg, patchOffset:DWORD, length:DWORD]
 * Replaces bytecode in the running VM starting at patchOffset with length bytes from srcReg.
 */
function buildDynPatchOpcode(srcReg, patchOffset, length, polyEndian = "BE") {
    const data = Buffer.alloc(1 + 4 + 4);
    data[0] = srcReg;

    if (polyEndian === "LE") {
        data.writeUInt32LE(patchOffset, 1);
        data.writeUInt32LE(length, 5);
    } else {
        data.writeUInt32BE(patchOffset, 1);
        data.writeUInt32BE(length, 5);
    }

    return new Opcode("DYN_PATCH", data);
}

/**
 * Runtime state for the dynamic loader, attached to VM instances.
 */
function createDynamicLoaderState() {
    return {
        buffer: null,
        keySeed: 0,
        loaded: false
    };
}

/**
 * Inject dynamic loader state into a VM instance.
 */
function injectDynamicLoader(vm) {
    if (!vm._dynamicLoader) {
        vm._dynamicLoader = createDynamicLoaderState();
    }
}

/**
 * Patch dynamic loader state into VM fork (for callbacks).
 */
function patchDynamicLoaderToFork(parent, fork) {
    if (parent._dynamicLoader) {
        fork._dynamicLoader = {
            buffer: parent._dynamicLoader.buffer
                ? new Uint8Array(parent._dynamicLoader.buffer)
                : null,
            keySeed: parent._dynamicLoader.keySeed,
            loaded: parent._dynamicLoader.loaded
        };
    }
}

module.exports = {
    encryptBytecode,
    decryptBytecode,
    deriveBytecodeKey,
    byteMask,
    buildDynLoadOpcode,
    buildDynExecOpcode,
    buildDynPatchOpcode,
    createDynamicLoaderState,
    injectDynamicLoader,
    patchDynamicLoaderToFork
};
