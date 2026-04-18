/**
 * Copyright (c) 2026 Bivex
 *
 * Author: Bivex
 * Available for contact via email: support@b-b.top
 * For up-to-date contact information:
 * https://github.com/bivex
 *
 * Created: 2026-03-26 18:54
 * Last Updated: 2026-03-26 18:54
 *
 * Licensed under the MIT License.
 * Commercial licensing available upon request.
 */

const globalScope = typeof globalThis !== "undefined"
    ? globalThis
    : typeof window !== "undefined"
        ? window
        : typeof global !== "undefined"
            ? global
            : {};

const nodeBuffer = typeof Buffer !== "undefined" ? Buffer : null;
const zlib = (() => {
    if (typeof require !== "function") {
        return null;
    }
    try {
        return require("node:zlib");
    } catch (error) {
        return null;
    }
})();

const BYTECODE_INTEGRITY_PREFIX = "JSCI1";
const BYTECODE_ENCRYPTED_PREFIX = "JSCX1";
const bytecodeKeyRegistry = new Map();

function rotateLeft(value, shift) {
    return ((value << shift) | (value >>> (32 - shift))) >>> 0;
}

function createBytecodeIntegrityDigest(payload, salt, key, format) {
    const normalizedPayload = String(payload ?? "");
    const normalizedSalt = String(salt ?? "");
    const normalizedKey = String(key ?? "");
    const normalizedFormat = String(format ?? "");
    const seed = `${normalizedSalt}:${normalizedFormat}:${normalizedPayload.length}:${normalizedKey.length}`;
    const input = `${seed}:${normalizedPayload}`;
    let a = (0x243f6a88 ^ input.length) >>> 0;
    let b = (0x85a308d3 ^ normalizedSalt.length) >>> 0;
    let c = (0x13198a2e ^ normalizedFormat.length) >>> 0;
    let d = (0x03707344 ^ normalizedKey.length) >>> 0;

    for (let i = 0; i < input.length; i++) {
        const code = input.charCodeAt(i);
        const keyCode = normalizedKey.length > 0 ? normalizedKey.charCodeAt(i % normalizedKey.length) : 0;
        const saltCode = normalizedSalt.length > 0 ? normalizedSalt.charCodeAt(i % normalizedSalt.length) : 0;
        a = Math.imul((a ^ (code + keyCode + i)) >>> 0, 0x45d9f3b) >>> 0;
        b = rotateLeft((b + code + saltCode + i) >>> 0, 5);
        b = Math.imul((b ^ a) >>> 0, 0x27d4eb2d) >>> 0;
        c = rotateLeft((c ^ (b + code + keyCode)) >>> 0, 11);
        c = Math.imul(c >>> 0, 0x165667b1) >>> 0;
        d = rotateLeft((d + (code ^ c) + saltCode) >>> 0, 17);
        d = Math.imul((d ^ a ^ keyCode) >>> 0, 0x9e3779b1) >>> 0;
    }

    a ^= b >>> 1;
    b ^= c >>> 3;
    c ^= d >>> 5;
    d ^= a >>> 7;

    return [a, b, c, d]
        .map((part) => (part >>> 0).toString(16).padStart(8, "0"))
        .join("");
}

function createSeedFromString(input, initial = 0x9e3779b9) {
    const normalizedInput = String(input ?? "");
    let seed = initial >>> 0;

    for (let i = 0; i < normalizedInput.length; i++) {
        seed = Math.imul((seed ^ normalizedInput.charCodeAt(i) ^ i) >>> 0, 0x45d9f3b) >>> 0;
        seed = rotateLeft(seed, 7);
    }

    return seed >>> 0;
}

function createSeededPermutation(length, seed) {
    const permutation = Array.from({length}, (_, index) => index);
    let state = (seed >>> 0) || 0x9e3779b9;

    for (let index = permutation.length - 1; index > 0; index--) {
        state = Math.imul((state ^ (state >>> 15)) >>> 0, 0x2c1b3c6d) >>> 0;
        state = (state + 0x9e3779b9 + index) >>> 0;
        const swapIndex = state % (index + 1);
        [permutation[index], permutation[swapIndex]] = [permutation[swapIndex], permutation[index]];
    }

    return permutation;
}

function encodeUtf8(value) {
    if (nodeBuffer) {
        return nodeBuffer.from(String(value ?? ""), "utf8");
    }

    if (typeof TextEncoder !== "undefined") {
        return new TextEncoder().encode(String(value ?? ""));
    }

    const normalizedValue = String(value ?? "");
    const bytes = new Uint8Array(normalizedValue.length);
    for (let i = 0; i < normalizedValue.length; i++) {
        bytes[i] = normalizedValue.charCodeAt(i) & 0xFF;
    }
    return bytes;
}

function decodeUtf8(bytes) {
    if (nodeBuffer) {
        return nodeBuffer.from(bytes).toString("utf8");
    }

    if (typeof TextDecoder !== "undefined") {
        return new TextDecoder().decode(bytes);
    }

    return Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
}

function createBytecodeCipherBytes(input, key, salt) {
    const normalizedKey = String(key ?? "");
    if (!normalizedKey) {
        throw new Error("VM decryption key not available");
    }

    const normalizedSalt = String(salt ?? "");
    const data = input instanceof Uint8Array ? input : new Uint8Array(input);
    const output = new Uint8Array(data.length);
    let stateA = createSeedFromString(`${normalizedKey}:${normalizedSalt}`, 0x243f6a88);
    let stateB = createSeedFromString(`${normalizedSalt}:${normalizedKey}`, 0x85a308d3);

    for (let i = 0; i < data.length; i++) {
        const keyCode = normalizedKey.charCodeAt(i % normalizedKey.length);
        const saltCode = normalizedSalt.length > 0 ? normalizedSalt.charCodeAt(i % normalizedSalt.length) : 0;

        stateA = Math.imul((stateA ^ keyCode ^ i) >>> 0, 0x27d4eb2d) >>> 0;
        stateA = rotateLeft(stateA, 5);
        stateB = Math.imul((stateB + saltCode + i + (stateA & 0xff)) >>> 0, 0x165667b1) >>> 0;
        stateB = rotateLeft(stateB, 9);

        output[i] = data[i] ^ ((stateA ^ stateB ^ keyCode ^ saltCode ^ (i * 17)) & 0xFF);
    }

    return output;
}

function deriveOpcodeStateSeed(key) {
    return createSeedFromString(`opcode:${String(key ?? "")}`, 0x6d2b79f5) || 0x6d2b79f5;
}

function deriveJumpTargetSeed(key) {
    return createSeedFromString(`jump:${String(key ?? "")}`, 0x1f123bb5) || 0x1f123bb5;
}

function deriveRuntimeDispatchSeed(key) {
    return createSeedFromString(`dispatch:${String(key ?? "")}`, 0x4f1bbcdc) || 0x4f1bbcdc;
}

function deriveAntiDebugSeed(key) {
    return createSeedFromString(`anti-debug:${String(key ?? "")}`, 0x7f4a7c15) || 0x7f4a7c15;
}

function deriveInstructionByteSeed(key) {
    return createSeedFromString(`instruction:${String(key ?? "")}`, 0x2e5aa50d) || 0x2e5aa50d;
}

function createOpcodePositionMask(seed, position) {
    let state = (seed ^ Math.imul((position + 1) >>> 0, 0x9e3779b1)) >>> 0;
    state = rotateLeft(state, position % 23 + 5);
    state ^= state >>> 16;
    return state & 0xFF;
}

function createJumpTargetByteMask(seed, position) {
    let state = (seed ^ Math.imul((position + 1) >>> 0, 0x27d4eb2d)) >>> 0;
    state = rotateLeft(state, position % 19 + 3);
    state ^= state >>> 15;
    return state & 0xFF;
}

function transformJumpTargetBytes(input, position, seed) {
    const data = input instanceof Uint8Array ? new Uint8Array(input) : new Uint8Array(input);
    for (let index = 0; index < data.length; index++) {
        data[index] ^= createJumpTargetByteMask(seed >>> 0, (position + index) >>> 0);
    }
    return data;
}

function createInstructionByteMask(seed, instructionPosition, bytePosition) {
    let state = (seed ^ Math.imul((instructionPosition + 1) >>> 0, 0x6d2b79f5) ^ Math.imul((bytePosition + 1) >>> 0, 0x45d9f3b)) >>> 0;
    state = rotateLeft(state, (instructionPosition + bytePosition) % 17 + 7);
    state ^= state >>> 13;
    return state & 0xFF;
}

function transformInstructionBytes(input, instructionPosition, seed) {
    const data = input instanceof Uint8Array ? new Uint8Array(input) : new Uint8Array(input);
    for (let index = 0; index < data.length; index++) {
        data[index] ^= createInstructionByteMask(seed >>> 0, instructionPosition >>> 0, (instructionPosition + 1 + index) >>> 0);
    }
    return data;
}

function decodeStatefulOpcode(opcode, position, seed) {
    return (opcode ^ createOpcodePositionMask(seed >>> 0, position >>> 0)) & 0xFF;
}

function isBase64Like(value) {
    return typeof value === "string" && /^[A-Za-z0-9+/=]+$/.test(value);
}

function normalizeEnvelopeFlags(flags) {
    const normalizedFlags = new Set(String(flags ?? "S").split("").filter((flag) => /^[A-Z]$/.test(flag)));
    if (!normalizedFlags.has("S")) {
        normalizedFlags.add("S");
    }
    return Array.from(normalizedFlags).sort().join("");
}

const DISPATCHER_VARIANTS = new Set(["permuted", "clustered", "striped"]);
const RUNTIME_OPCODE_DERIVATION_MODES = new Set(["hybrid", "stateful", "position"]);
const DEFAULT_VM_PROFILE = Object.freeze({
    profileId: "classic",
    registerCount: 256,
    dispatcherVariant: "permuted",
    aliasBaseCount: 2,
    aliasJitter: 1,
    decoyCount: 18,
    decoyStride: 3,
    runtimeOpcodeDerivation: "hybrid",
    polyEndian: "BE"
});

function clampInteger(value, min, max, fallback) {
    if (!Number.isInteger(value)) {
        return fallback;
    }
    return Math.max(min, Math.min(max, value));
}

function normalizeVMProfile(profile = {}) {
    const normalized = {
        ...DEFAULT_VM_PROFILE,
        ...profile
    };

    normalized.profileId = String(profile.profileId ?? DEFAULT_VM_PROFILE.profileId);
    normalized.registerCount = clampInteger(profile.registerCount, registerNames.length + 1, 256, DEFAULT_VM_PROFILE.registerCount);
    normalized.dispatcherVariant = DISPATCHER_VARIANTS.has(profile.dispatcherVariant)
        ? profile.dispatcherVariant
        : DEFAULT_VM_PROFILE.dispatcherVariant;
    normalized.aliasBaseCount = clampInteger(profile.aliasBaseCount, 1, 4, DEFAULT_VM_PROFILE.aliasBaseCount);
    normalized.aliasJitter = clampInteger(profile.aliasJitter, 0, 3, DEFAULT_VM_PROFILE.aliasJitter);
    normalized.decoyCount = clampInteger(profile.decoyCount, 0, 64, DEFAULT_VM_PROFILE.decoyCount);
    normalized.decoyStride = clampInteger(profile.decoyStride, 1, 8, DEFAULT_VM_PROFILE.decoyStride);
    normalized.runtimeOpcodeDerivation = RUNTIME_OPCODE_DERIVATION_MODES.has(profile.runtimeOpcodeDerivation)
        ? profile.runtimeOpcodeDerivation
        : DEFAULT_VM_PROFILE.runtimeOpcodeDerivation;
    normalized.polyEndian = (profile.polyEndian === "LE" || profile.polyEndian === "BE")
        ? profile.polyEndian
        : DEFAULT_VM_PROFILE.polyEndian || "BE";
    return normalized;
}

function interleaveDispatchDecoys(entries, decoys, stride) {
    const result = [];
    let realCount = 0;
    const normalizedStride = Math.max(1, stride || 1);

    for (const entry of entries) {
        result.push(entry);
        if (entry.kind !== "real") {
            continue;
        }
        realCount += 1;
        if (decoys.length > 0 && realCount >= normalizedStride) {
            result.push(decoys.shift());
            realCount = 0;
        }
    }

    return result.concat(decoys);
}

function buildDispatchEntries(realEntries, realGroups, decoyEntries, profile, seed) {
    switch (profile.dispatcherVariant) {
        case "clustered":
            return interleaveDispatchDecoys(realEntries.slice(), decoyEntries.slice(), profile.decoyStride);
        case "striped": {
            const striped = [];
            const groups = realGroups.map((group) => group.slice());
            let hasEntries = true;

            while (hasEntries) {
                hasEntries = false;
                for (const group of groups) {
                    if (group.length === 0) {
                        continue;
                    }
                    striped.push(group.shift());
                    hasEntries = true;
                }
            }

            return interleaveDispatchDecoys(striped, decoyEntries.slice(), profile.decoyStride);
        }
        default: {
            const entries = [...realEntries, ...decoyEntries];
            const entryOrder = createSeededPermutation(entries.length, seed ^ 0x7f4a7c15);
            return entryOrder.map((index) => entries[index]);
        }
    }
}

function deriveAliasIndex(profile, slotsLength, opcode, position, runtimeState, runtimeDispatchSeed) {
    if (slotsLength <= 1) {
        return 0;
    }

    switch (profile.runtimeOpcodeDerivation) {
        case "position":
            return createOpcodePositionMask(runtimeDispatchSeed || 0x4f1bbcdc, (position ^ opcode) >>> 0) % slotsLength;
        case "stateful":
            return createOpcodePositionMask(runtimeState || runtimeDispatchSeed || 0x4f1bbcdc, opcode) % slotsLength;
        default: {
            const mixedState = (runtimeState || runtimeDispatchSeed || 0x4f1bbcdc) ^ rotateLeft((position + 1) >>> 0, opcode % 13 + 3);
            return createOpcodePositionMask(mixedState >>> 0, (position ^ opcode) >>> 0) % slotsLength;
        }
    }
}

function mixRuntimeOpcodeState(state, opcode, position, salt = 0) {
    let next = (state ^ Math.imul((opcode + 1) >>> 0, 0x45d9f3b) ^ Math.imul((position + 1) >>> 0, 0x165667b1) ^ salt) >>> 0;
    next = rotateLeft(next, opcode % 19 + 5);
    next = Math.imul((next ^ (next >>> 16)) >>> 0, 0x27d4eb2d) >>> 0;
    return next || 0x9e3779b9;
}

function resolveRegisteredBytecodeKey(keyId) {
    const normalizedKeyId = String(keyId ?? "");

    if (bytecodeKeyRegistry.has(normalizedKeyId)) {
        return bytecodeKeyRegistry.get(normalizedKeyId);
    }

    if (globalScope.__JSV_BYTECODE_KEYS && normalizedKeyId in globalScope.__JSV_BYTECODE_KEYS) {
        return String(globalScope.__JSV_BYTECODE_KEYS[normalizedKeyId]);
    }

    if (typeof process !== "undefined" && process.env && process.env[normalizedKeyId]) {
        return String(process.env[normalizedKeyId]);
    }

    throw new Error("VM decryption key not available");
}

function unpackBytecodeEnvelope(code, format, key) {
    if (typeof code !== "string") {
        return {
            payload: code,
            encrypted: false,
            statefulOpcodes: false,
            jumpTargetEncoding: false
        };
    }

    if (code.startsWith(`${BYTECODE_ENCRYPTED_PREFIX}:`)) {
        const parts = code.split(":");
        if (parts.length < 5) {
            throw new Error("Malformed protected bytecode envelope");
        }

        const salt = parts[1];
        const keyId = parts[2];
        const hasFlags = !/^[a-f0-9]{32}$/i.test(parts[3]);
        const flags = hasFlags ? normalizeEnvelopeFlags(parts[3]) : "S";
        const expectedDigest = hasFlags ? parts[4] : parts[3];
        const payload = hasFlags ? parts.slice(5).join(":") : parts.slice(4).join(":");
        const digestInput = hasFlags ? `${keyId}:${flags}:${payload}` : `${keyId}:${payload}`;
        const actualDigest = createBytecodeIntegrityDigest(digestInput, salt, key, format);

        if (expectedDigest !== actualDigest) {
            throw new Error("Bytecode integrity check failed");
        }

        const decryptionKey = resolveRegisteredBytecodeKey(keyId);
        const decryptedPayload = decodeUtf8(createBytecodeCipherBytes(decodeBase64ToBytes(payload), decryptionKey, salt));

        if (format === "base64" && !isBase64Like(decryptedPayload)) {
            throw new Error("VM bytecode decryption failed");
        }

        return {
            payload: decryptedPayload,
            encrypted: true,
            statefulOpcodes: flags.includes("S"),
            jumpTargetEncoding: flags.includes("J"),
            perInstructionEncoding: flags.includes("I")
        };
    }

    if (!code.startsWith(`${BYTECODE_INTEGRITY_PREFIX}:`)) {
        return {
            payload: code,
            encrypted: false,
            statefulOpcodes: false,
            jumpTargetEncoding: false,
            perInstructionEncoding: false
        };
    }

    const start = BYTECODE_INTEGRITY_PREFIX.length + 1;
    const saltEnd = code.indexOf(":", start);
    const digestEnd = saltEnd === -1 ? -1 : code.indexOf(":", saltEnd + 1);

    if (saltEnd === -1 || digestEnd === -1) {
        throw new Error("Malformed protected bytecode envelope");
    }

    const salt = code.slice(start, saltEnd);
    const expectedDigest = code.slice(saltEnd + 1, digestEnd);
    const payload = code.slice(digestEnd + 1);
    const actualDigest = createBytecodeIntegrityDigest(payload, salt, key, format);

    if (expectedDigest !== actualDigest) {
        throw new Error("Bytecode integrity check failed");
    }

    return {
        payload,
        encrypted: false,
        statefulOpcodes: false,
        jumpTargetEncoding: false,
        perInstructionEncoding: false
    };
}

function createAntiDebugState(key) {
    return {
        enabled: true,
        key: String(key ?? ""),
        seed: deriveAntiDebugSeed(key),
        suspicionScore: 0,
        appliedSuspicion: 0,
        instructionCount: 0,
        lastStepAt: 0,
        pauseThresholdMs: 1200,
        sampleInterval: 64,
        devtoolsThreshold: 160,
        disruptionCount: 0
    };
}

function cloneAntiDebugState(state) {
    if (!state) {
        return null;
    }
    return {
        ...state,
        lastStepAt: 0
    };
}

function createMemoryProtectionState(key, numProtected) {
    const normalizedKey = String(key ?? "");
    let seed = 0x9e3779b9;
    for (let i = 0; i < normalizedKey.length; i++) {
        seed = Math.imul((seed ^ normalizedKey.charCodeAt(i)) >>> 0, 0x45d9f3b) >>> 0;
    }
    return {
        enabled: true,
        seed,
        heap: new Map(),
        nextToken: 1,
        laneEpoch: 0
    };
}

function createRegisterProtectionMask(seed, register) {
    return rotateLeft((seed ^ Math.imul(register + 1, 0x9e3779b1)) >>> 0, register % 29 + 3);
}

function createProtectedRegisterValue(state, register, value) {
    state.laneEpoch += 1;
    const token = state.nextToken++;
    state.heap.set(token, value);
    const laneSeed = (state.seed ^ Math.imul(state.laneEpoch, 0x9e3779b1)) >>> 0;
    const maskedToken = (token ^ createRegisterProtectionMask(laneSeed, register)) >>> 0;
    const guard = rotateLeft((maskedToken ^ laneSeed ^ register) >>> 0, 11);
    return {
        __jsvmProtected: true,
        token: maskedToken,
        guard,
        laneEpoch: state.laneEpoch
    };
}

function restoreProtectedRegisterValue(state, register, value, options = {}) {
    if (!value || value.__jsvmProtected !== true) {
        return value;
    }
    const laneEpoch = value.laneEpoch >>> 0;
    const laneSeed = (state.seed ^ Math.imul(laneEpoch, 0x9e3779b1)) >>> 0;
    const expectedGuard = rotateLeft((value.token ^ laneSeed ^ register) >>> 0, 11);
    if (value.guard !== expectedGuard) {
        throw new Error("VM register protection check failed");
    }
    const token = (value.token ^ createRegisterProtectionMask(laneSeed, register)) >>> 0;
    if (!state.heap.has(token)) {
        throw new Error("VM register protection token missing");
    }
    const resolvedValue = state.heap.get(token);
    if (options.consume) {
        state.heap.delete(token);
    }
    return resolvedValue;
}

function createRegisterReference(value) {
    return {
        value
    };
}

function decodeBase64ToBytes(code) {
    if (nodeBuffer) {
        return nodeBuffer.from(code, "base64");
    }

    if (typeof globalScope.atob === "function") {
        const binary = globalScope.atob(code);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }

    throw new Error("Base64 decoding is not available in this runtime");
}

function decodeBytecodeBuffer(code, format) {
    if (!format) {
        return code;
    }

    if (nodeBuffer) {
        return nodeBuffer.from(code, format);
    }

    if (format === "base64") {
        return decodeBase64ToBytes(code);
    }

    throw new Error(`Unsupported browser bytecode encoding: ${format}`);
}

function inflateBytecode(buffer) {
    if (zlib && typeof zlib.inflateSync === "function") {
        return zlib.inflateSync(buffer);
    }

    if (globalScope.pako && typeof globalScope.pako.inflate === "function") {
        return globalScope.pako.inflate(buffer);
    }

    throw new Error("Compressed browser bytecode requires globalThis.pako.inflate");
}

const registerNames = ["INSTRUCTION_POINTER", "UNDEFINED", "VOID"]
const opNames = ["LOAD_BYTE", "LOAD_BOOL", "LOAD_DWORD", "LOAD_FLOAT", "LOAD_STRING", "LOAD_ARRAY", "LOAD_OBJECT", "SETUP_OBJECT", "SETUP_ARRAY", "INIT_CONSTRUCTOR", "FUNC_CALL", "FUNC_ARRAY_CALL", "FUNC_ARRAY_CALL_AWAIT", "AWAIT", "VFUNC_CALL", "VFUNC_SETUP_CALLBACK", "VFUNC_RETURN", "JUMP_UNCONDITIONAL", "JUMP_EQ", "JUMP_NOT_EQ", "TRY_CATCH_FINALLY", "THROW", "THROW_ARGUMENT", "MACRO_LOAD_DWORD_PAIR", "MACRO_TEST_JUMP_EQ", "MACRO_TEST_JUMP_NOT_EQ", "CFF_DISPATCH", "SET", "SET_REF", "SET_PROP", "GET_PROP", "SET_INDEX", "GET_INDEX", "WRITE_EXT", "DETACH_REF", "SET_NULL", "SET_UNDEFINED", "EQ_COERCE", "EQ", "NOT_EQ_COERCE", "NOT_EQ", "LESS_THAN", "LESS_THAN_EQ", "GREATER_THAN", "GREATER_THAN_EQ", "TEST", "TEST_NEQ", "ADD", "SUBTRACT", "MULTIPLY", "DIVIDE", "MODULO", "POWER", "AND", "BNOT", "OR", "XOR", "SHIFT_LEFT", "SHIFT_RIGHT", "SPREAD", "SPREAD_INTO", "NOT", "NEGATE", "PLUS", "INCREMENT", "DECREMENT", "TYPEOF", "VOID", "DELETE", "LOGICAL_AND", "LOGICAL_OR", "LOGICAL_NULLISH", "GET_ITERATOR", "ITERATOR_NEXT", "ITERATOR_DONE", "ITERATOR_VALUE", "GET_PROPERTIES", "NOP", "END", "PRINT"]

const reservedNames = new Set(registerNames)
reservedNames.delete("VOID")

const registers = {}

for (let i = 0; i < registerNames.length; i++) {
    registers[registerNames[i]] = i
}

const opcodes = {}

for (let i = 0; i < opNames.length; i++) {
    opcodes[opNames[i]] = i
}

const implOpcode = {
    LOAD_BYTE: function () {
        const register = this.readByte(), value = this.readByte();
        this.write(register, value);
    }, LOAD_BOOL: function () {
        const register = this.readByte(), value = this.readBool();
        this.write(register, value);
    }, LOAD_DWORD: function () {
        const register = this.readByte(), value = this.readDWORD();
        this.write(register, value);
    }, LOAD_FLOAT: function () {
        const register = this.readByte(), value = this.readFloat();
        this.write(register, value);
    }, LOAD_STRING: function () {
        const register = this.readByte(), value = this.readString();
        this.write(register, value);
    }, LOAD_ARRAY: function () {
        const register = this.readByte(), value = this.readArray();
        this.write(register, value);
    }, LOAD_OBJECT: function () {
        const register = this.readByte(), keys = this.readArray(), values = this.readArray();
        const obj = {};
        for (let i = 0; i < keys.length; i++) {
            obj[keys[i]] = values[i]
        }
        this.write(register, obj);
    }, SETUP_OBJECT: function () {
        const register = this.readByte();
        this.write(register, {});
    }, SETUP_ARRAY: function () {
        const register = this.readByte(), size = this.readDWORD();
        this.write(register, Array(size));
    }, INIT_CONSTRUCTOR: function () {
        const register = this.readByte(), constructor = this.readByte(), args = this.readByte()
        this.write(register, new (this.read(constructor))(...this.read(args)));
    }, FUNC_CALL: function () {
        const fn = this.readByte(), dst = this.readByte(), funcThis = this.readByte(), args = this.readArray()
        const res = this.read(fn).apply(this.read(funcThis), args);
        this.write(dst, res);
    }, FUNC_ARRAY_CALL: function () {
        const fn = this.readByte(), dst = this.readByte(), funcThis = this.readByte(), argsReg = this.readByte();
        const args = this.read(argsReg);
        const res = this.read(fn).apply(this.read(funcThis), args);
        this.write(dst, res);
    }, FUNC_ARRAY_CALL_AWAIT: async function () {
        const fn = this.readByte(), dst = this.readByte(), funcThis = this.readByte(), argsReg = this.readByte();
        const args = this.read(argsReg);
        const res = await this.read(fn).apply(this.read(funcThis), args);
        this.write(dst, res);
    }, AWAIT: async function () {
        const dest = this.readByte(), src = this.readByte();
        this.write(dest, await this.read(src));
    }, VFUNC_CALL: function () {
        const cur = this.read(registers.INSTRUCTION_POINTER);
        const offset = this.readDWORD(), returnDataStore = this.readByte(), argMap = this.readArrayRegisters();
        this.regstack.push([this.captureRegisterSnapshot(), returnDataStore, new Map(this.registerRefs)]);
        for (let i = 0; i < argMap.length; i += 2) {
            this.write(argMap[i], this.read(argMap[i + 1]));
        }
        this.registers[registers.INSTRUCTION_POINTER] = cur + offset - 1;
    }, VFUNC_SETUP_CALLBACK: function () {
        const cur = this.read(registers.INSTRUCTION_POINTER);
        const fnOffset = this.readDWORD(), dest = this.readByte(), returnDataStore = this.readByte(),
            isAsync = this.readBool(), hasDynamicThis = this.readBool(), thisRegister = this.readByte(), usesArguments = this.readBool(), argumentsRegister = this.readByte(), useRest = this.readBool(), argArrayMapper = this.readArrayRegisters(), argOrder = this.readArrayRegisters(), captureMappings = this.readArrayRegisters();
        const vm = this;
        const captureReferences = [];

        for (let i = 0; i < captureMappings.length; i += 2) {
            const captureRegister = captureMappings[i];
            const sourceRegister = captureMappings[i + 1];
            const reference = vm.getOrCreateRegisterReference(sourceRegister);
            captureReferences.push({
                captureRegister,
                reference
            });
        }

        function bindCaptureReferences(target) {
            for (const {captureRegister, reference} of captureReferences) {
                target.bindRegisterReference(captureRegister, reference);
            }
        }

        function runSync(thisArg, args) {
            const fork = new vm.constructor(vm.getProfile());
            fork.setBytecodeIntegrityKey(vm.bytecodeIntegrityKey);
            fork.code = vm.selfModifyingBytecode ? new Uint8Array(vm.code) : vm.code;
            fork.registers = vm.captureRegisterSnapshot();
            fork.regstack = [];
            fork.registerRefs = new Map(vm.registerRefs);
            fork.statefulOpcodesEnabled = vm.statefulOpcodesEnabled;
            fork.jumpTargetEncodingEnabled = vm.jumpTargetEncodingEnabled;
            fork.perInstructionEncodingEnabled = vm.perInstructionEncodingEnabled;
            fork.runtimeOpcodeState = vm.runtimeOpcodeState;
            fork.adoptMemoryProtectionState(vm.memoryProtectionState);
            fork.adoptAntiDebugState(vm.antiDebugState);
            fork.selfModifyingBytecode = vm.selfModifyingBytecode;
            fork.codeBackup = vm.codeBackup;
            fork.selfModifySeed = vm.selfModifySeed;
            bindCaptureReferences(fork);
            const restIndex = argOrder.length - 1;
            if (hasDynamicThis) {
                fork.write(thisRegister, thisArg);
            }
            if (usesArguments) {
                fork.write(argumentsRegister, args);
            }
            for (let i = 0; i < argArrayMapper.length; i++) {
                const sourceIndex = argOrder[i];
                if (useRest && sourceIndex === restIndex) {
                    fork.write(argArrayMapper[i], args.slice(sourceIndex));
                    continue;
                }
                fork.write(argArrayMapper[i], args[sourceIndex]);
            }
            fork.registers[registers.INSTRUCTION_POINTER] = cur + fnOffset - 1;
            if (vm.selfModifyingBytecode && vm.codeBackup) {
                fork.restoreBytecodeRange(0, fork.code.length);
            }
            fork.run()
            const res = fork.read(returnDataStore);
            return res
        }

        async function runAsync(thisArg, args) {
            const fork = new vm.constructor(vm.getProfile());
            fork.setBytecodeIntegrityKey(vm.bytecodeIntegrityKey);
            fork.code = vm.selfModifyingBytecode ? new Uint8Array(vm.code) : vm.code;
            fork.registers = vm.captureRegisterSnapshot();
            fork.regstack = [];
            fork.registerRefs = new Map(vm.registerRefs);
            fork.statefulOpcodesEnabled = vm.statefulOpcodesEnabled;
            fork.jumpTargetEncodingEnabled = vm.jumpTargetEncodingEnabled;
            fork.perInstructionEncodingEnabled = vm.perInstructionEncodingEnabled;
            fork.runtimeOpcodeState = vm.runtimeOpcodeState;
            fork.adoptMemoryProtectionState(vm.memoryProtectionState);
            fork.adoptAntiDebugState(vm.antiDebugState);
            fork.selfModifyingBytecode = vm.selfModifyingBytecode;
            fork.codeBackup = vm.codeBackup;
            fork.selfModifySeed = vm.selfModifySeed;
            bindCaptureReferences(fork);
            const restIndex = argOrder.length - 1;
            if (hasDynamicThis) {
                fork.write(thisRegister, thisArg);
            }
            if (usesArguments) {
                fork.write(argumentsRegister, args);
            }
            for (let i = 0; i < argArrayMapper.length; i++) {
                const sourceIndex = argOrder[i];
                if (useRest && sourceIndex === restIndex) {
                    fork.write(argArrayMapper[i], args.slice(sourceIndex));
                    continue;
                }
                fork.write(argArrayMapper[i], args[sourceIndex]);
            }
            fork.registers[registers.INSTRUCTION_POINTER] = cur + fnOffset - 1;
            if (vm.selfModifyingBytecode && vm.codeBackup) {
                fork.restoreBytecodeRange(0, fork.code.length);
            }
            await fork.runAsync()
            const res = fork.read(returnDataStore);
            return res
        }

        const cb = isAsync
            ? async function (...args) {
                return runAsync(this, args);
            }
            : function (...args) {
                return runSync(this, args);
            };

        this.write(dest, cb);
    }, VFUNC_RETURN: function () {
        const internalReturnReg = this.readByte();
        const restoreRegisters = this.readArrayRegisters();
        const retValue = this.read(internalReturnReg);
        const [oldRegisters, returnDataStore, oldRegisterRefs] = this.regstack.pop();

        restoreRegisters.push(registers.INSTRUCTION_POINTER);
        for (const restoreRegister of restoreRegisters) {
            this.registers[restoreRegister] = oldRegisters[restoreRegister];
        }
        this.releaseRegisterSnapshot(oldRegisters, restoreRegisters);
        if (oldRegisterRefs) {
            this.registerRefs = oldRegisterRefs;
        }
        this.write(returnDataStore, retValue);
    }, JUMP_UNCONDITIONAL: function () {
        const cur = this.read(registers.INSTRUCTION_POINTER);
        const offset = this.readJumpTargetDWORD();
        this.registers[registers.INSTRUCTION_POINTER] = cur + offset - 1;
    }, JUMP_EQ: function () {
        const cur = this.read(registers.INSTRUCTION_POINTER);
        const register = this.readByte(), offset = this.readJumpTargetDWORD();
        if (this.read(register)) {

            this.registers[registers.INSTRUCTION_POINTER] = cur + offset - 1;
        }
    }, JUMP_NOT_EQ: function () {
        const cur = this.read(registers.INSTRUCTION_POINTER);
        const register = this.readByte(), offset = this.readJumpTargetDWORD();
        if (!this.read(register)) {

            this.registers[registers.INSTRUCTION_POINTER] = cur + offset - 1;
        } else {

        }
    }, TRY_CATCH_FINALLY: function () {
        const cur = this.read(registers.INSTRUCTION_POINTER);
        const errorRegister = this.readByte();
        const catchOffset = this.readJumpTargetDWORD(), finallyOffset = this.readJumpTargetDWORD();
        if (this.executionMode === "async") {
            return (async () => {
                try {
                    await this.runAsync();
                } catch (e) {
                    this.write(errorRegister, e);
                    this.registers[registers.INSTRUCTION_POINTER] = cur + catchOffset - 1;
                    await this.runAsync();
                } finally {
                    this.registers[registers.INSTRUCTION_POINTER] = cur + finallyOffset - 1
                    await this.runAsync();
                }
            })();
        }
        try {
            this.run();
        } catch (e) {
            this.write(errorRegister, e);
            this.registers[registers.INSTRUCTION_POINTER] = cur + catchOffset - 1;
            this.run();
        } finally {
            this.registers[registers.INSTRUCTION_POINTER] = cur + finallyOffset - 1
            this.run();
        }
    }, THROW: function () {
        const errRegister = this.readByte();
        throw new Error(this.read(errRegister));
    }, THROW_ARGUMENT: function () {
        const errRegister = this.readByte();
        throw this.read(errRegister);
    }, MACRO_LOAD_DWORD_PAIR: function () {
        const firstRegister = this.readByte();
        const firstValue = this.readDWORD();
        const secondRegister = this.readByte();
        const secondValue = this.readDWORD();
        this.readByte();
        this.write(firstRegister, firstValue);
        this.write(secondRegister, secondValue);
    }, MACRO_TEST_JUMP_EQ: function () {
        const cur = this.read(registers.INSTRUCTION_POINTER);
        const testDest = this.readByte();
        const testSrc = this.readByte();
        const jumpRegister = this.readByte();
        const offset = this.readJumpTargetDWORD();
        this.readByte();
        this.write(testDest, !!this.read(testSrc));
        if (this.read(jumpRegister)) {
            this.registers[registers.INSTRUCTION_POINTER] = cur + offset + 2;
        }
    }, MACRO_TEST_JUMP_NOT_EQ: function () {
        const cur = this.read(registers.INSTRUCTION_POINTER);
        const testDest = this.readByte();
        const testSrc = this.readByte();
        const jumpRegister = this.readByte();
        const offset = this.readJumpTargetDWORD();
        this.readByte();
        this.write(testDest, !!this.read(testSrc));
        if (!this.read(jumpRegister)) {
            this.registers[registers.INSTRUCTION_POINTER] = cur + offset + 2;
        }
    }, CFF_DISPATCH: function () {
        const cur = this.read(registers.INSTRUCTION_POINTER);
        const stateReg = this.readByte();
        const currentState = this.read(stateReg);
        const numEntries = this.readDWORD();
        for (let i = 0; i < numEntries; i++) {
            const entryState = this.readDWORD();
            const entryOffset = this.readJumpTargetDWORD();
            if (currentState === entryState) {
                this.registers[registers.INSTRUCTION_POINTER] = cur + entryOffset - 1;
                return;
            }
        }
    }, SET: function () {
        const dest = this.readByte(), src = this.readByte();
        this.write(dest, src);
    }, SET_REF: function () {
        const dest = this.readByte(), src = this.readByte();
        this.write(dest, this.read(src));
    }, WRITE_EXT: function () {
        const dest = this.readByte(), src = this.readByte();
        const ref = this.read(dest);
        ref.write(this.read(src));
    }, DETACH_REF: function () {
        this.detachRegisterReference(this.readByte());
    }, SET_NULL: function () {
        const dest = this.readByte();
        this.write(dest, null);
    }, SET_UNDEFINED: function () {
        const dest = this.readByte();
        this.write(dest, undefined);
    }, SET_PROP: function () {
        const object = this.readByte(), prop = this.readByte(), src = this.readByte();
        const obj = this.read(object);
        obj[this.read(prop)] = this.read(src);
    }, GET_PROP: function () {
        const dest = this.readByte(), object = this.readByte(), prop = this.readByte();

        this.write(dest, this.read(object)[this.read(prop)]);
    }, SET_INDEX: function () {
        const array = this.readByte(), index = this.readByte(), src = this.readByte();
        this.read(array)[this.read(index)] = this.read(src);
    }, GET_INDEX: function () {
        const dest = this.readByte(), array = this.readByte(), index = this.readByte();
        this.write(dest, this.read(array)[this.read(index)]);
    }, EQ_COERCE: function () {
        const dest = this.readByte(), left = this.readByte(), right = this.readByte();
        this.write(dest, this.read(left) == this.read(right));
    }, EQ: function () {
        const dest = this.readByte(), left = this.readByte(), right = this.readByte();

        this.write(dest, this.read(left) === this.read(right));
    }, NOT_EQ_COERCE: function () {
        const dest = this.readByte(), left = this.readByte(), right = this.readByte();
        this.write(dest, this.read(left) != this.read(right));
    }, NOT_EQ: function () {
        const dest = this.readByte(), left = this.readByte(), right = this.readByte();
        this.write(dest, this.read(left) !== this.read(right));
    }, LESS_THAN: function () {
        const dest = this.readByte(), left = this.readByte(), right = this.readByte();
        this.write(dest, this.read(left) < this.read(right));
    }, LESS_THAN_EQ: function () {
        const dest = this.readByte(), left = this.readByte(), right = this.readByte();
        this.write(dest, this.read(left) <= this.read(right));
    }, GREATER_THAN: function () {
        const dest = this.readByte(), left = this.readByte(), right = this.readByte();
        this.write(dest, this.read(left) > this.read(right));
    }, GREATER_THAN_EQ: function () {
        const dest = this.readByte(), left = this.readByte(), right = this.readByte();
        this.write(dest, this.read(left) >= this.read(right));
    }, TEST: function () {
        const dest = this.readByte(), src = this.readByte();
        this.write(dest, !!this.read(src));
    }, TEST_NEQ: function () {
        const dest = this.readByte(), src = this.readByte();
        this.write(dest, !this.read(src));
    }, ADD: function () {
        const dest = this.readByte(), left = this.readByte(), right = this.readByte();
        this.write(dest, this.read(left) + this.read(right));
    }, SUBTRACT: function () {
        const dest = this.readByte(), left = this.readByte(), right = this.readByte();
        this.write(dest, this.read(left) - this.read(right));
    }, MULTIPLY: function () {
        const dest = this.readByte(), left = this.readByte(), right = this.readByte();
        this.write(dest, this.read(left) * this.read(right));
    }, DIVIDE: function () {
        const dest = this.readByte(), left = this.readByte(), right = this.readByte();
        this.write(dest, this.read(left) / this.read(right));
    }, MODULO: function () {
        const dest = this.readByte(), left = this.readByte(), right = this.readByte();
        this.write(dest, this.read(left) % this.read(right));
    }, POWER: function () {
        const dest = this.readByte(), left = this.readByte(), right = this.readByte();
        this.write(dest, Math.pow(this.read(left), this.read(right)));
    }, AND: function () {
        const dest = this.readByte(), left = this.readByte(), right = this.readByte();
        this.write(dest, this.read(left) & this.read(right));
    }, BNOT: function () {
        const dest = this.readByte(), src = this.readByte();
        this.write(dest, ~this.read(src));
    }, OR: function () {
        const dest = this.readByte(), left = this.readByte(), right = this.readByte();
        this.write(dest, this.read(left) | this.read(right));
    }, XOR: function () {
        const dest = this.readByte(), left = this.readByte(), right = this.readByte();
        this.write(dest, this.read(left) ^ this.read(right));
    }, SHIFT_LEFT: function () {
        const dest = this.readByte(), src = this.readByte(), shift = this.readByte();
        this.write(dest, this.read(src) << this.read(shift));
    }, SHIFT_RIGHT: function () {
        const dest = this.readByte(), src = this.readByte(), shift = this.readByte();
        this.write(dest, this.read(src) >> this.read(shift));
    }, SPREAD: function () {
        const dest = this.readByte(), src = this.readByte();
        this.write(dest, ...this.read(src));
    }, SPREAD_INTO: function () {
        const dest = this.readByte(), src = this.readByte()
        if (this.read(dest) instanceof Array) {
            this.write(dest, [...this.read(dest), ...this.read(src)]);
        } else if (this.read(dest) instanceof Object) {
            this.write(dest, {...this.read(dest), ...this.read(src)});
        } else {
            throw new Error("Cannot spread into non-object or non-array");
        }
    }, NOT: function () {
        const dest = this.readByte(), src = this.readByte();
        this.write(dest, !this.read(src));
    }, NEGATE: function () {
        const dest = this.readByte(), src = this.readByte();
        this.write(dest, -this.read(src));
    }, PLUS: function () {
        const dest = this.readByte(), src = this.readByte();
        this.write(dest, +this.read(src));
    }, INCREMENT: function () {
        const dest = this.readByte();
        this.write(dest, this.read(dest) + 1);
    }, DECREMENT: function () {
        const dest = this.readByte();
        this.write(dest, this.read(dest) - 1);
    }, TYPEOF: function () {
        const dest = this.readByte(), src = this.readByte();
        this.write(dest, typeof this.read(src));
    }, VOID: function () {
        const dest = this.readByte(), src = this.readByte();
        this.write(dest, void this.read(src));
    }, DELETE: function () {
        const dest = this.readByte(), src = this.readByte();
        this.write(dest, delete this.read(src));
    }, LOGICAL_AND: function () {
        const dest = this.readByte(), left = this.readByte(), right = this.readByte();
        this.write(dest, this.read(left) && this.read(right));
    }, LOGICAL_OR: function () {
        const dest = this.readByte(), left = this.readByte(), right = this.readByte();
        this.write(dest, this.read(left) || this.read(right));
    }, LOGICAL_NULLISH: function () {
        const dest = this.readByte(), left = this.readByte(), right = this.readByte();
        this.write(dest, this.read(left) ?? this.read(right));
    }, GET_ITERATOR: function () {
        const dest = this.readByte(), src = this.readByte();
        this.write(dest, this.read(src)[Symbol.iterator]());
    }, ITERATOR_NEXT: function () {
        const dest = this.readByte(), iterator = this.readByte();
        const next = this.read(iterator).next();
        this.write(dest, next);
    }, ITERATOR_DONE: function () {
        const dest = this.readByte(), iterator = this.readByte();
        this.write(dest, this.read(iterator).done);
    }, ITERATOR_VALUE: function () {
        const dest = this.readByte(), iterator = this.readByte();
        this.write(dest, this.read(iterator).value);
    }, GET_PROPERTIES: function () {
        const dest = this.readByte(), src = this.readByte();
        const res = Object.getOwnPropertyNames(this.read(src))
        if (this.read(src) instanceof Array) {
            res.pop()
        }
        this.write(dest, res);
    }, NOP: function () {
    }, END: function () {
    }, PRINT: function () {
        console.log(this.read(this.readByte()));
    }
};

class JSVM {
    constructor(profile = null) {
        this.vmProfile = normalizeVMProfile(profile ?? undefined)
        this.registers = new Array(this.vmProfile.registerCount).fill(null)
        this.regstack = []
        this.opcodes = {}
        this.dispatchHandlers = []
        this.dispatchLookup = []
        this.dispatchSlotKinds = []
        this.code = null
        this.bytecodeIntegrityKey = ""
        this.opcodeStateSeed = 0
        this.statefulOpcodesEnabled = false
        this.jumpTargetSeed = 0
        this.jumpTargetEncodingEnabled = false
        this.instructionByteSeed = 0
        this.perInstructionEncodingEnabled = false
        this.currentInstructionBase = null
        this.runtimeDispatchSeed = 0
        this.runtimeOpcodeState = 0
        this.antiDebugState = null
        this.memoryProtectionState = null
        this.registerRefs = new Map()
        this.executionMode = "sync"
        this.selfModifyingBytecode = false
        this.codeBackup = null
        this.selfModifySeed = 0
        this.registers[registers.INSTRUCTION_POINTER] = 0
        this.registers[registers.UNDEFINED] = undefined
        this.registers[registers.VOID] = 0
        Object.keys(opcodes).forEach((opcode) => {
            this.opcodes[opcodes[opcode]] = implOpcode[opcode].bind(this)
        })
        const jumpOpcodeNames = ["JUMP_UNCONDITIONAL", "JUMP_EQ", "JUMP_NOT_EQ", "MACRO_TEST_JUMP_EQ", "MACRO_TEST_JUMP_NOT_EQ"]
        for (const name of jumpOpcodeNames) {
            const idx = opcodes[name]
            const originalHandler = this.opcodes[idx]
            if (originalHandler) {
                const vm = this
                this.opcodes[idx] = () => {
                    const ipBefore = vm.read(registers.INSTRUCTION_POINTER)
                    originalHandler()
                    if (vm.selfModifyingBytecode) {
                        const ipAfter = vm.read(registers.INSTRUCTION_POINTER)
                        if (ipAfter < ipBefore) {
                            vm.restoreBytecodeRange(ipAfter, ipBefore)
                        }
                    }
                }
            }
        }
        this.refreshDispatchTable()
    }

    static createBytecodeIntegrityDigest(code, salt, key, format) {
        return createBytecodeIntegrityDigest(code, salt, key, format)
    }

    static createBytecodeIntegrityEnvelope(code, format, key, salt) {
        const normalizedSalt = String(salt ?? "");
        const digest = createBytecodeIntegrityDigest(code, normalizedSalt, key, format);
        return `${BYTECODE_INTEGRITY_PREFIX}:${normalizedSalt}:${digest}:${code}`;
    }

    static registerBytecodeKey(keyId, key) {
        bytecodeKeyRegistry.set(String(keyId ?? ""), String(key ?? ""));
        return this
    }

    static deriveJumpTargetSeed(key) {
        return deriveJumpTargetSeed(key)
    }

    static deriveInstructionByteSeed(key) {
        return deriveInstructionByteSeed(key)
    }

    static encodeJumpTargetBytes(bytes, position, seed) {
        return transformJumpTargetBytes(bytes, position, seed)
    }

    static encodeInstructionBytes(bytes, instructionPosition, seed) {
        return transformInstructionBytes(bytes, instructionPosition, seed)
    }

    static normalizeProfile(profile) {
        return normalizeVMProfile(profile)
    }

    getProfile() {
        return {
            ...this.vmProfile
        }
    }

    refreshDispatchTable() {
        const realPermutation = createSeededPermutation(opNames.length, this.opcodeStateSeed || 0x9e3779b9);
        const realEntries = [];
        const realGroups = [];

        for (const opcode of realPermutation) {
            const aliasCount = this.vmProfile.aliasBaseCount + (
                this.vmProfile.aliasJitter > 0
                    ? createOpcodePositionMask(this.runtimeDispatchSeed || 0x4f1bbcdc, opcode) % (this.vmProfile.aliasJitter + 1)
                    : 0
            );
            const group = [];
            for (let aliasIndex = 0; aliasIndex < aliasCount; aliasIndex++) {
                const entry = {
                    kind: "real",
                    opcode
                };
                realEntries.push(entry);
                group.push(entry);
            }
            realGroups.push(group);
        }

        const decoyEntries = [];
        const decoyCount = this.vmProfile.decoyCount;
        for (let decoyIndex = 0; decoyIndex < decoyCount; decoyIndex++) {
            decoyEntries.push({
                kind: "decoy",
                seed: (this.runtimeDispatchSeed ^ Math.imul(decoyIndex + 1, 0x9e3779b1)) >>> 0
            });
        }

        const entries = buildDispatchEntries(
            realEntries,
            realGroups,
            decoyEntries,
            this.vmProfile,
            this.runtimeDispatchSeed || 0x4f1bbcdc
        );
        this.dispatchHandlers = new Array(entries.length);
        this.dispatchLookup = Array.from({length: opNames.length}, () => []);
        this.dispatchSlotKinds = new Array(entries.length);

        for (let slot = 0; slot < entries.length; slot++) {
            const entry = entries[slot];

            if (entry.kind === "real") {
                this.dispatchLookup[entry.opcode].push(slot);
                this.dispatchHandlers[slot] = this.opcodes[entry.opcode];
                this.dispatchSlotKinds[slot] = "real";
                continue;
            }

            this.dispatchHandlers[slot] = (() => {
                const seed = entry.seed;
                return () => {
                    this.runtimeOpcodeState = mixRuntimeOpcodeState(this.runtimeOpcodeState || this.runtimeDispatchSeed || 0x4f1bbcdc, seed & 0xFF, slot, seed);
                };
            })();
            this.dispatchSlotKinds[slot] = "decoy";
        }
    }

    setBytecodeIntegrityKey(key) {
        this.bytecodeIntegrityKey = String(key ?? "")
        this.opcodeStateSeed = this.bytecodeIntegrityKey ? deriveOpcodeStateSeed(this.bytecodeIntegrityKey) : 0
        this.jumpTargetSeed = this.bytecodeIntegrityKey ? deriveJumpTargetSeed(this.bytecodeIntegrityKey) : 0
        this.instructionByteSeed = this.bytecodeIntegrityKey ? deriveInstructionByteSeed(this.bytecodeIntegrityKey) : 0
        this.runtimeDispatchSeed = this.bytecodeIntegrityKey ? deriveRuntimeDispatchSeed(this.bytecodeIntegrityKey) : 0
        this.runtimeOpcodeState = this.runtimeDispatchSeed || 0x4f1bbcdc
        this.refreshDispatchTable()
        return this
    }

    adoptAntiDebugState(state) {
        this.antiDebugState = cloneAntiDebugState(state);
        return this;
    }

    enableAntiDebug(key) {
        this.antiDebugState = createAntiDebugState(key);
        this.runtimeOpcodeState = mixRuntimeOpcodeState(this.runtimeOpcodeState || this.runtimeDispatchSeed || 0x4f1bbcdc, this.antiDebugState.seed & 0xFF, 0, this.antiDebugState.seed);
        return this;
    }

    enableSelfModifyingBytecode(key) {
        this.selfModifyingBytecode = true
        const normalizedKey = String(key ?? "")
        let seed = 0x5bd1e995
        for (let i = 0; i < normalizedKey.length; i++) {
            seed = Math.imul((seed ^ normalizedKey.charCodeAt(i)) >>> 0, 0x45d9f3b) >>> 0
        }
        this.selfModifySeed = seed
        return this
    }

    scrambleInstruction(startPos, endPos) {
        if (!this.code || endPos <= startPos) return
        const mask = ((this.selfModifySeed ^ Math.imul((startPos + 1) >>> 0, 0x165667b1)) >>> 0) & 0xFF
        for (let i = startPos; i < endPos; i++) {
            this.code[i] ^= (mask ^ ((i * 7) & 0xFF)) & 0xFF
        }
    }

    restoreBytecodeRange(fromPos, toPos) {
        if (!this.codeBackup || toPos <= fromPos) return
        for (let i = fromPos; i < toPos; i++) {
            const mask = ((this.selfModifySeed ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0) & 0xFF
            this.code[i] = this.codeBackup[i] ^ mask
        }
    }

    runAntiDebugSweep(position) {
        if (!this.antiDebugState || !this.antiDebugState.enabled) {
            return;
        }

        const state = this.antiDebugState;
        const now = Date.now();

        if (state.lastStepAt && now - state.lastStepAt > state.pauseThresholdMs && state.instructionCount > 4) {
            state.suspicionScore += 1;
        }

        if (typeof window !== "undefined" && window) {
            const widthDelta = Math.abs((window.outerWidth ?? 0) - (window.innerWidth ?? 0));
            const heightDelta = Math.abs((window.outerHeight ?? 0) - (window.innerHeight ?? 0));
            if (widthDelta > state.devtoolsThreshold || heightDelta > state.devtoolsThreshold) {
                state.suspicionScore += 1;
            }
            if (state.suspicionScore >= 2 && globalScope.__JSV_DISABLE_DEBUG_TRAPS__ !== true) {
                try {
                    Function("debugger")();
                    state.disruptionCount += 1;
                } catch (error) {
                }
            }
        }

        state.instructionCount += 1;
        state.lastStepAt = now;

        if (state.suspicionScore > state.appliedSuspicion) {
            this.runtimeOpcodeState = mixRuntimeOpcodeState(this.runtimeOpcodeState || this.runtimeDispatchSeed || 0x4f1bbcdc, state.seed & 0xFF, position, state.suspicionScore);
            state.appliedSuspicion = state.suspicionScore;
        }
    }

    advanceRuntimeOpcodeState(opcode, position) {
        this.runtimeOpcodeState = mixRuntimeOpcodeState(
            this.runtimeOpcodeState || this.runtimeDispatchSeed || 0x4f1bbcdc,
            opcode,
            position,
            this.antiDebugState ? this.antiDebugState.suspicionScore : 0
        );
    }

    adoptMemoryProtectionState(state) {
        this.memoryProtectionState = state ?? null;
        return this;
    }

    enableMemoryProtection(key) {
        const existingValues = [];
        for (let register = registerNames.length; register < this.registers.length; register++) {
            existingValues.push({
                register,
                value: this.readStored(register)
            });
        }
        this.memoryProtectionState = createMemoryProtectionState(key, this.registers.length - registerNames.length);
        existingValues.forEach(({register, value}) => {
            if (value !== null) {
                this.registers[register] = createProtectedRegisterValue(this.memoryProtectionState, register, value);
            }
        });
        return this;
    }

    isProtectedRegister(register) {
        return !!(this.memoryProtectionState && this.memoryProtectionState.enabled && register >= registerNames.length);
    }

    rotateProtectedRegisters() {
        if (!this.memoryProtectionState || !this.memoryProtectionState.enabled) {
            return this;
        }

        for (let register = registerNames.length; register < this.registers.length; register++) {
            if (this.registerRefs.has(register)) {
                continue;
            }

            const storedValue = this.registers[register];
            if (storedValue === null) {
                continue;
            }

            const resolvedValue = restoreProtectedRegisterValue(this.memoryProtectionState, register, storedValue, {
                consume: storedValue && storedValue.__jsvmProtected === true
            });
            this.registers[register] = createProtectedRegisterValue(this.memoryProtectionState, register, resolvedValue);
        }

        return this;
    }

    captureRegisterSnapshot() {
        if (!this.memoryProtectionState || !this.memoryProtectionState.enabled) {
            return this.registers.slice();
        }

        const snapshot = this.registers.slice();
        for (let register = registerNames.length; register < snapshot.length; register++) {
            if (this.registerRefs.has(register)) {
                continue;
            }

            const resolvedValue = this.readStored(register);
            snapshot[register] = resolvedValue === null ? null : createProtectedRegisterValue(this.memoryProtectionState, register, resolvedValue);
        }

        return snapshot;
    }

    releaseRegisterSnapshot(snapshot, preservedRegisters = []) {
        if (!this.memoryProtectionState || !this.memoryProtectionState.enabled || !snapshot) {
            return this;
        }

        const preserved = new Set(preservedRegisters);
        for (let register = registerNames.length; register < snapshot.length; register++) {
            if (preserved.has(register)) {
                continue;
            }
            const storedValue = snapshot[register];
            if (storedValue && storedValue.__jsvmProtected === true) {
                restoreProtectedRegisterValue(this.memoryProtectionState, register, storedValue, {consume: true});
            }
        }

        return this;
    }

    readStored(register) {
        if (!this.isProtectedRegister(register)) {
            return this.registers[register]
        }
        const resolvedValue = restoreProtectedRegisterValue(this.memoryProtectionState, register, this.registers[register], {
            consume: true
        });
        this.registers[register] = createProtectedRegisterValue(this.memoryProtectionState, register, resolvedValue);
        return resolvedValue
    }

    writeStored(register, value) {
        if (reservedNames.has(registerNames[register])) {
            throw new Error(`Tried to modify reserved register: ${registerNames[register]} (${register})`)
        }
        if (!this.isProtectedRegister(register)) {
            this.registers[register] = value
            return
        }
        if (this.registers[register] && this.registers[register].__jsvmProtected === true) {
            restoreProtectedRegisterValue(this.memoryProtectionState, register, this.registers[register], {
                consume: true
            });
        }
        this.registers[register] = createProtectedRegisterValue(this.memoryProtectionState, register, value)
    }

    clearStoredRegister(register) {
        if (!this.isProtectedRegister(register)) {
            this.registers[register] = null
            return this
        }

        const storedValue = this.registers[register]
        if (storedValue && storedValue.__jsvmProtected === true) {
            restoreProtectedRegisterValue(this.memoryProtectionState, register, storedValue, {
                consume: true
            })
        }

        this.registers[register] = null
        return this
    }

    getOrCreateRegisterReference(register) {
        if (this.registerRefs.has(register)) {
            return this.registerRefs.get(register)
        }
        const reference = createRegisterReference(this.readStored(register))
        this.registerRefs.set(register, reference)
        this.clearStoredRegister(register)
        return reference
    }

    bindRegisterReference(register, reference) {
        this.registerRefs.set(register, reference)
        this.clearStoredRegister(register)
        return reference
    }

    detachRegisterReference(register) {
        if (!this.registerRefs.has(register)) {
            return null
        }
        const reference = this.registerRefs.get(register)
        this.registerRefs.delete(register)
        this.writeStored(register, reference.value)
        return reference
    }

    read(register) {
        if (this.registerRefs.has(register)) {
            return this.registerRefs.get(register).value
        }
        return this.readStored(register)
    }

    write(register, value) {
        if (reservedNames.has(registerNames[register])) {
            throw new Error(`Tried to modify reserved register: ${registerNames[register]} (${register})`)
        }
        if (this.registerRefs.has(register)) {
            this.registerRefs.get(register).value = value
            return
        }
        this.writeStored(register, value)
    }

    readRawByte() {
        const position = this.read(registers.INSTRUCTION_POINTER);
        const byte = this.code[position];
        this.registers[registers.INSTRUCTION_POINTER] = position + 1;
        return byte;
    }

    readByte() {
        const position = this.read(registers.INSTRUCTION_POINTER)
        const byte = this.code[position]
        this.registers[registers.INSTRUCTION_POINTER] = position + 1;
        if (
            byte !== undefined &&
            this.perInstructionEncodingEnabled &&
            this.instructionByteSeed &&
            this.currentInstructionBase !== null &&
            position > this.currentInstructionBase
        ) {
            return byte ^ createInstructionByteMask(this.instructionByteSeed >>> 0, this.currentInstructionBase >>> 0, position >>> 0);
        }
        return byte
    }

    readOpcode() {
        const position = this.read(registers.INSTRUCTION_POINTER)
        this.currentInstructionBase = position
        const opcode = this.readRawByte()

        if (opcode === undefined) {
            return {
                opcode,
                position
            }
        }

        if (!this.statefulOpcodesEnabled || !this.opcodeStateSeed) {
            return {
                opcode,
                position
            }
        }

        return {
            opcode: decodeStatefulOpcode(opcode, position, this.opcodeStateSeed),
            position
        }
    }

    resolveOpcodeHandler(opcode, position = 0) {
        const slots = this.dispatchLookup[opcode]
        if (!slots || slots.length === 0) {
            return null
        }
        const aliasIndex = deriveAliasIndex(
            this.vmProfile,
            slots.length,
            opcode,
            position,
            this.runtimeOpcodeState,
            this.runtimeDispatchSeed
        )
        return this.dispatchHandlers[slots[aliasIndex]] ?? null
    }

    readBool() {
        const bool = this.readByte() === 1
        return bool
    }

    readArrayRegisters() {
        const length = this.readByte()
        const array = []
        for (let i = 0; i < length; i++) {
            array.push(this.readByte())
        }
        return array
    }

    readArray() {
        const length = this.readByte()
        const array = []
        for (let i = 0; i < length; i++) {

            array.push(this.read(this.readByte()))
        }

        return array
    }

    readDWORD() {
        const b1 = this.readByte();
        const b2 = this.readByte();
        const b3 = this.readByte();
        const b4 = this.readByte();
        if (this.vmProfile && this.vmProfile.polyEndian === "LE") {
            return b1 | (b2 << 8) | (b3 << 16) | (b4 << 24);
        }
        return b1 << 24 | b2 << 16 | b3 << 8 | b4;
    }

    readInstructionDecodedByteArray(length) {
        const bytes = new Uint8Array(length);
        for (let index = 0; index < length; index++) {
            bytes[index] = this.readByte();
        }
        return bytes;
    }

    readJumpTargetDWORD() {
        const position = this.read(registers.INSTRUCTION_POINTER);
        const bytes = this.readInstructionDecodedByteArray(4);

        if (!this.jumpTargetEncodingEnabled || !this.jumpTargetSeed) {
            // Use endianness from profile
            return this.vmProfile && this.vmProfile.polyEndian === "LE"
                ? (bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24))
                : ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]);
        }

        const decoded = transformJumpTargetBytes(bytes, position, this.jumpTargetSeed);
        return this.vmProfile && this.vmProfile.polyEndian === "LE"
            ? (decoded[0] | (decoded[1] << 8) | (decoded[2] << 16) | (decoded[3] << 24))
            : ((decoded[0] << 24) | (decoded[1] << 16) | (decoded[2] << 8) | decoded[3]);
    }

    readFloat() {
        let binary = "";
        for (let i = 0; i < 8; ++i) {
            binary += this.readByte().toString(2).padStart(8, '0');
        }
        const sign = (binary.charAt(0) === '1') ? -1 : 1;
        let exponent = parseInt(binary.substring(1, 12), 2);
        let significandBase = binary.substring(12);
        let significandBin;
        if (exponent === 0) {
            if (significandBase.indexOf('1') === -1) {

                return 0;
            } else {
                exponent = -0x3fe;
                significandBin = '0' + significandBase;
            }
        } else {
            exponent -= 0x3ff;
            significandBin = '1' + significandBase;
        }
        let significand = 0;
        for (let i = 0, val = 1; i < significandBin.length; ++i, val /= 2) {
            significand += val * parseInt(significandBin.charAt(i));
        }

        return sign * significand * Math.pow(2, exponent);
    }

    readString() {
        const length = this.readDWORD()
        let str = ''
        for (let i = 0; i < length; i++) {
            str += String.fromCharCode(this.readByte() ^ ((length * 31 + i * 17) & 0xFF))
        }
        return str
    }

    loadFromString(code, format) {
        const envelope = unpackBytecodeEnvelope(code, format, this.bytecodeIntegrityKey)
        code = envelope.payload
        this.statefulOpcodesEnabled = envelope.statefulOpcodes
        this.jumpTargetEncodingEnabled = envelope.jumpTargetEncoding
        this.perInstructionEncodingEnabled = envelope.perInstructionEncoding
        if (!format) {

            this.code = code
        } else {
            const buffer = decodeBytecodeBuffer(code, format)
            if (envelope.encrypted) {
                try {
                    this.code = inflateBytecode(buffer)
                } catch (error) {
                    throw new Error("VM bytecode decryption failed");
                }
            } else if (buffer[0] === 0x78 && buffer[1] === 0x9c) {

                this.code = inflateBytecode(buffer)
            } else {
                this.code = buffer
            }
        }
        if (this.selfModifyingBytecode && this.code) {
            this.codeBackup = new Uint8Array(this.code.length)
            for (let i = 0; i < this.code.length; i++) {
                const mask = ((this.selfModifySeed ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0) & 0xFF
                this.codeBackup[i] = this.code[i] ^ mask
            }
        }
    }

    loadDependencies(dependencies) {
        Object.keys(dependencies).forEach((key) => {

            this.write(parseInt(key), dependencies[key])
        })
    }

    run() {
        this.executionMode = "sync"
        while (true) {
            const {opcode, position} = this.readOpcode()
            if (opcode === undefined || opNames[opcode] === "END") {
                this.currentInstructionBase = null
                break
            }
            this.runAntiDebugSweep(position)
            const handler = this.resolveOpcodeHandler(opcode, position)
            if (!handler) {
                this.advanceRuntimeOpcodeState(opcode, position)
                this.rotateProtectedRegisters()
                this.currentInstructionBase = null
                continue
            }
            try {
                handler()
            } catch (e) {

                throw e
            } finally {
                this.advanceRuntimeOpcodeState(opcode, position)
                this.rotateProtectedRegisters()
                if (this.selfModifyingBytecode && position !== undefined && this.code) {
                    const currentIP = this.read(registers.INSTRUCTION_POINTER)
                    this.scrambleInstruction(position, currentIP)
                }
                this.currentInstructionBase = null
            }
        }
    }

    async runAsync() {
        this.executionMode = "async"
        while (true) {
            const {opcode, position} = this.readOpcode()
            if (opcode === undefined || opNames[opcode] === "END") {
                this.currentInstructionBase = null
                break
            }
            this.runAntiDebugSweep(position)
            const handler = this.resolveOpcodeHandler(opcode, position)
            if (!handler) {
                this.advanceRuntimeOpcodeState(opcode, position)
                this.rotateProtectedRegisters()
                this.currentInstructionBase = null
                continue
            }

            try {
                await handler()
            } catch (e) {

                throw e
            } finally {
                this.advanceRuntimeOpcodeState(opcode, position)
                this.rotateProtectedRegisters()
                if (this.selfModifyingBytecode && position !== undefined && this.code) {
                    const currentIP = this.read(registers.INSTRUCTION_POINTER)
                    this.scrambleInstruction(position, currentIP)
                }
                this.currentInstructionBase = null
            }
        }
    }
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = JSVM
} else if (typeof globalThis !== "undefined") {
    globalThis.JSVM = JSVM
}
