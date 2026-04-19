/**
 * Copyright (c) 2026 Bivex
 *
 * Platform‑agnostic shared utilities for JSVM.
 * These are used by both the Node development VM (vm_dev.js) and
 * the distribution/browser VM (vm_dist.js).
 */

// Re-export canonical constants from the single source of truth
const {
    registerNames,
    reservedNames,
    registers,
    opNames,
    opcodes
} = require("./constants");

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

function encodeStatefulOpcode(opcode, position, seed) {
    return (opcode ^ createOpcodePositionMask(seed >>> 0, position >>> 0)) & 0xFF;
}

function decodeStatefulOpcode(opcode, position, seed) {
    return encodeStatefulOpcode(opcode, position, seed);
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

function deriveNestedKey(key) {
    return createSeedFromString(`nested:${String(key ?? "")}`, 0x3c2b1a09) || 0x3c2b1a09;
}

function deriveInnerShuffleSeed(key) {
    return createSeedFromString(`inner-shuffle:${String(key ?? "")}`, 0x5a4b3c2d) || 0x5a4b3c2d;
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

function createInstructionByteMask(seed, instructionPosition, bytePosition) {
    let state = (seed ^ Math.imul((instructionPosition + 1) >>> 0, 0x6d2b79f5) ^ Math.imul((bytePosition + 1) >>> 0, 0x45d9f3b)) >>> 0;
    state = rotateLeft(state, (instructionPosition + bytePosition) % 17 + 7);
    state ^= state >>> 13;
    return state & 0xFF;
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

function clampInteger(value, min, max, fallback) {
    if (!Number.isInteger(value)) {
        return fallback;
    }
    return Math.max(min, Math.min(max, value));
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

    if (typeof globalThis !== "undefined" && globalThis.__JSV_BYTECODE_KEYS && normalizedKeyId in globalThis.__JSV_BYTECODE_KEYS) {
        return String(globalThis.__JSV_BYTECODE_KEYS[normalizedKeyId]);
    }

    if (typeof process !== "undefined" && process.env && process.env[normalizedKeyId]) {
        return String(process.env[normalizedKeyId]);
    }

    throw new Error("VM decryption key not available");
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
    state.laneEpoch = (state.laneEpoch + 1) >>> 0;
    const token = state.nextToken = (state.nextToken + 1) >>> 0;
    state.heap.set(token, value);

    const laneSeed = (state.seed ^ Math.imul(state.laneEpoch, 0x9e3779b1)) >>> 0;
    const maskedToken = (token ^ createRegisterProtectionMask(laneSeed, register)) >>> 0;
    const guard = rotateLeft((maskedToken ^ laneSeed ^ register) >>> 0, 11);

    return {
        __jsvmProtected: true,
        token,
        guard,
        register
    };
}

function createRegisterReference(value) {
    return {
        value
    };
}

function restoreProtectedRegisterValue(state, register, value, options = {}) {
    if (!value || value.__jsvmProtected !== true) {
        return value;
    }
    if (options.consume) {
        state.heap.delete(value.token);
        return value.value;
    }
    const laneSeed = (state.seed ^ Math.imul(state.laneEpoch, 0x9e3779b1)) >>> 0;
    const unmaskedToken = (value.token ^ createRegisterProtectionMask(laneSeed, register)) >>> 0;
    const expectedGuard = rotateLeft((unmaskedToken ^ laneSeed ^ register) >>> 0, 11);
    if (value.guard !== expectedGuard) {
        throw new Error("Protected register value validation failed");
    }
    return state.heap.get(unmaskedToken);
}

// --- Platform byte abstractions ---

function copyBuffer(input) {
    if (typeof Buffer !== "undefined" && Buffer.isBuffer(input)) {
        return Buffer.from(input);
    }
    if (input instanceof Uint8Array) {
        return new Uint8Array(input);
    }
    // treat as array-like of bytes
    return Buffer.from(input);
}

function toUint8Array(input) {
    if (typeof Buffer !== "undefined" && Buffer.isBuffer(input)) {
        return new Uint8Array(input);
    }
    if (input instanceof Uint8Array) {
        return input;
    }
    // fallback
    return new Uint8Array(input);
}

// --- Constants & opcode infrastructure ---

function copyBuffer(input) {
    if (typeof Buffer !== "undefined" && Buffer.isBuffer(input)) {
        return Buffer.from(input);
    }
    if (input instanceof Uint8Array) {
        return new Uint8Array(input);
    }
    // treat as array-like of bytes
    return Buffer.from(input);
}

function toUint8Array(input) {
    if (typeof Buffer !== "undefined" && Buffer.isBuffer(input)) {
        return new Uint8Array(input);
    }
    if (input instanceof Uint8Array) {
        return input;
    }
    // fallback
    return new Uint8Array(input);
}

// --- Constants & opcode infrastructure (Node build uses same as browser) ---
// Re-exported from ./constants; definitions live there to avoid duplication

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

// Opcode implementation table (identical across builds)
const implOpcode = {
    LOAD_BYTE: function () {
        const register = this.readByte(), value = this.readByte();
        this.write(register, value);
    },
    LOAD_BOOL: function () {
        const register = this.readByte(), value = this.readBool();
        this.write(register, value);
    },
    LOAD_DWORD: function () {
        const register = this.readByte(), value = this.readDWORD();
        this.write(register, value);
    },
    LOAD_FLOAT: function () {
        const register = this.readByte(), value = this.readFloat();
        this.write(register, value);
    },
    LOAD_STRING: function () {
        const register = this.readByte(), value = this.readString();
        this.write(register, value);
    },
    LOAD_ARRAY: function () {
        const register = this.readByte(), value = this.readArray();
        this.write(register, value);
    },
    LOAD_OBJECT: function () {
        const register = this.readByte(), keys = this.readArray(), values = this.readArray();
        const obj = {};
        for (let i = 0; i < keys.length; i++) {
            obj[keys[i]] = values[i]
        }
        this.write(register, obj);
    },
    SETUP_OBJECT: function () {
        const register = this.readByte();
        this.write(register, {});
    },
    SETUP_ARRAY: function () {
        const register = this.readByte(), size = this.readDWORD();
        this.write(register, Array(size));
    },
    INIT_CONSTRUCTOR: function () {
        const register = this.readByte(), constructor = this.readByte(), args = this.readByte()
        this.write(register, new (this.read(constructor))(...this.read(args)));
    },
    FUNC_CALL: function () {
        const fn = this.readByte(), dst = this.readByte(), funcThis = this.readByte(), args = this.readArray()
        const res = this.read(fn).apply(this.read(funcThis), args);
        this.write(dst, res);
    },
    FUNC_ARRAY_CALL: function () {
        const fn = this.readByte(), dst = this.readByte(), funcThis = this.readByte(), argsReg = this.readByte();
        const args = this.read(argsReg);
        const res = this.read(fn).apply(this.read(funcThis), args);
        this.write(dst, res);
    },
    FUNC_ARRAY_CALL_AWAIT: async function () {
        const fn = this.readByte(), dst = this.readByte(), funcThis = this.readByte(), argsReg = this.readByte();
        const args = this.read(argsReg);
        const res = await this.read(fn).apply(this.read(funcThis), args);
        this.write(dst, res);
    },
    AWAIT: async function () {
        const dest = this.readByte(), src = this.readByte();
        this.write(dest, await this.read(src));
    },
    VFUNC_CALL: function () {
        const cur = this.read(registers.INSTRUCTION_POINTER);
        const offset = this.readDWORD(), returnDataStore = this.readByte(), argMap = this.readArrayRegisters();
        this.regstack.push([this.captureRegisterSnapshot(), returnDataStore, new Map(this.registerRefs)]);
        for (let i = 0; i < argMap.length; i += 2) {
            this.write(argMap[i], this.read(argMap[i + 1]));
        }
        this.registers[registers.INSTRUCTION_POINTER] = cur + offset - 1;
    },
    VFUNC_SETUP_CALLBACK: function () {
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
            fork.code = vm.selfModifyingBytecode ? toUint8Array(vm.code) : vm.code;
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
            fork.code = vm.selfModifyingBytecode ? toUint8Array(vm.code) : vm.code;
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
    },
    VFUNC_RETURN: function () {
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
    },
    JUMP_UNCONDITIONAL: function () {
        const cur = this.read(registers.INSTRUCTION_POINTER);
        const offset = this.readJumpTargetDWORD();
        this.registers[registers.INSTRUCTION_POINTER] = cur + offset - 1;
    },
    JUMP_EQ: function () {
        const cur = this.read(registers.INSTRUCTION_POINTER);
        const register = this.readByte(), offset = this.readJumpTargetDWORD();
        if (this.read(register)) {

            this.registers[registers.INSTRUCTION_POINTER] = cur + offset - 1;
        }
    },
    JUMP_NOT_EQ: function () {
        const cur = this.read(registers.INSTRUCTION_POINTER);
        const register = this.readByte(), offset = this.readJumpTargetDWORD();
        if (!this.read(register)) {

            this.registers[registers.INSTRUCTION_POINTER] = cur + offset - 1;
        } else {

        }
    },
    TRY_CATCH_FINALLY: function () {
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
    },
    THROW: function () {
        const errRegister = this.readByte();
        throw new Error(this.read(errRegister));
    },
    THROW_ARGUMENT: function () {
        const errRegister = this.readByte();
        throw this.read(errRegister);
    },
    MACRO_LOAD_DWORD_PAIR: function () {
        const firstRegister = this.readByte();
        const firstValue = this.readDWORD();
        const secondRegister = this.readByte();
        const secondValue = this.readDWORD();
        this.readByte();
        this.write(firstRegister, firstValue);
        this.write(secondRegister, secondValue);
    },
    MACRO_TEST_JUMP_EQ: function () {
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
    },
    MACRO_TEST_JUMP_NOT_EQ: function () {
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
    },
    CFF_DISPATCH: function () {
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
    },
    SET: function () {
        const dest = this.readByte(), src = this.readByte();
        this.write(dest, src);
    },
    SET_REF: function () {
        const dest = this.readByte(), src = this.readByte();
        this.write(dest, this.read(src));
    },
    WRITE_EXT: function () {
        const dest = this.readByte(), src = this.readByte();
        const ref = this.read(dest);
        ref.write(this.read(src));
    },
    DETACH_REF: function () {
        this.detachRegisterReference(this.readByte());
    },
    SET_NULL: function () {
        const dest = this.readByte();
        this.write(dest, null);
    },
    SET_UNDEFINED: function () {
        const dest = this.readByte();
        this.write(dest, undefined);
    },
    SET_PROP: function () {
        const object = this.readByte(), prop = this.readByte(), src = this.readByte();
        const obj = this.read(object);
        obj[this.read(prop)] = this.read(src);
    },
    GET_PROP: function () {
        const dest = this.readByte(), object = this.readByte(), prop = this.readByte();

        this.write(dest, this.read(object)[this.read(prop)]);
    },
    SET_INDEX: function () {
        const array = this.readByte(), index = this.readByte(), src = this.readByte();
        this.read(array)[this.read(index)] = this.read(src);
    },
    GET_INDEX: function () {
        const dest = this.readByte(), array = this.readByte(), index = this.readByte();
        this.write(dest, this.read(array)[this.read(index)]);
    },
    EQ_COERCE: function () {
        const dest = this.readByte(), left = this.readByte(), right = this.readByte();
        this.write(dest, this.read(left) == this.read(right));
    },
    EQ: function () {
        const dest = this.readByte(), left = this.readByte(), right = this.readByte();

        this.write(dest, this.read(left) === this.read(right));
    },
    NOT_EQ_COERCE: function () {
        const dest = this.readByte(), left = this.readByte(), right = this.readByte();
        this.write(dest, this.read(left) != this.read(right));
    },
    NOT_EQ: function () {
        const dest = this.readByte(), left = this.readByte(), right = this.readByte();
        this.write(dest, this.read(left) !== this.read(right));
    },
    LESS_THAN: function () {
        const dest = this.readByte(), left = this.readByte(), right = this.readByte();
        this.write(dest, this.read(left) < this.read(right));
    },
    LESS_THAN_EQ: function () {
        const dest = this.readByte(), left = this.readByte(), right = this.readByte();
        this.write(dest, this.read(left) <= this.read(right));
    },
    GREATER_THAN: function () {
        const dest = this.readByte(), left = this.readByte(), right = this.readByte();
        this.write(dest, this.read(left) > this.read(right));
    },
    GREATER_THAN_EQ: function () {
        const dest = this.readByte(), left = this.readByte(), right = this.readByte();
        this.write(dest, this.read(left) >= this.read(right));
    },
    TEST: function () {
        const dest = this.readByte(), src = this.readByte();
        this.write(dest, !!this.read(src));
    },
    TEST_NEQ: function () {
        const dest = this.readByte(), src = this.readByte();
        this.write(dest, !this.read(src));
    },
    ADD: function () {
        const dest = this.readByte(), left = this.readByte(), right = this.readByte();
        this.write(dest, this.read(left) + this.read(right));
    },
    SUBTRACT: function () {
        const dest = this.readByte(), left = this.readByte(), right = this.readByte();
        this.write(dest, this.read(left) - this.read(right));
    },
    MULTIPLY: function () {
        const dest = this.readByte(), left = this.readByte(), right = this.readByte();
        this.write(dest, this.read(left) * this.read(right));
    },
    DIVIDE: function () {
        const dest = this.readByte(), left = this.readByte(), right = this.readByte();
        this.write(dest, this.read(left) / this.read(right));
    },
    MODULO: function () {
        const dest = this.readByte(), left = this.readByte(), right = this.readByte();
        this.write(dest, this.read(left) % this.read(right));
    },
    POWER: function () {
        const dest = this.readByte(), left = this.readByte(), right = this.readByte();
        this.write(dest, Math.pow(this.read(left), this.read(right)));
    },
    AND: function () {
        const dest = this.readByte(), left = this.readByte(), right = this.readByte();
        this.write(dest, this.read(left) & this.read(right));
    },
    BNOT: function () {
        const dest = this.readByte(), src = this.readByte();
        this.write(dest, ~this.read(src));
    },
    OR: function () {
        const dest = this.readByte(), left = this.readByte(), right = this.readByte();
        this.write(dest, this.read(left) | this.read(right));
    },
    XOR: function () {
        const dest = this.readByte(), left = this.readByte(), right = this.readByte();
        this.write(dest, this.read(left) ^ this.read(right));
    },
    SHIFT_LEFT: function () {
        const dest = this.readByte(), src = this.readByte(), shift = this.readByte();
        this.write(dest, this.read(src) << this.read(shift));
    },
    SHIFT_RIGHT: function () {
        const dest = this.readByte(), src = this.readByte(), shift = this.readByte();
        this.write(dest, this.read(src) >> this.read(shift));
    },
    SPREAD: function () {
        const dest = this.readByte(), src = this.readByte();
        this.write(dest, ...this.read(src));
    },
    SPREAD_INTO: function () {
        const dest = this.readByte(), src = this.readByte()
        if (this.read(dest) instanceof Array) {
            this.write(dest, [...this.read(dest), ...this.read(src)]);
        } else if (this.read(dest) instanceof Object) {
            this.write(dest, {...this.read(dest), ...this.read(src)});
        } else {
            throw new Error("Cannot spread into non-object or non-array");
        }
    },
    NOT: function () {
        const dest = this.readByte(), src = this.readByte();
        this.write(dest, !this.read(src));
    },
    NEGATE: function () {
        const dest = this.readByte(), src = this.readByte();
        this.write(dest, -this.read(src));
    },
    PLUS: function () {
        const dest = this.readByte(), src = this.readByte();
        this.write(dest, +this.read(src));
    },
    INCREMENT: function () {
        const dest = this.readByte();
        this.write(dest, this.read(dest) + 1);
    },
    DECREMENT: function () {
        const dest = this.readByte();
        this.write(dest, this.read(dest) - 1);
    },
    TYPEOF: function () {
        const dest = this.readByte(), src = this.readByte();
        this.write(dest, typeof this.read(src));
    },
    VOID: function () {
        const dest = this.readByte(), src = this.readByte();
        this.write(dest, void this.read(src));
    },
    DELETE: function () {
        const dest = this.readByte(), src = this.readByte();
        this.write(dest, delete this.read(src));
    },
    LOGICAL_AND: function () {
        const dest = this.readByte(), left = this.readByte(), right = this.readByte();
        this.write(dest, this.read(left) && this.read(right));
    },
    LOGICAL_OR: function () {
        const dest = this.readByte(), left = this.readByte(), right = this.readByte();
        this.write(dest, this.read(left) || this.read(right));
    },
    LOGICAL_NULLISH: function () {
        const dest = this.readByte(), left = this.readByte(), right = this.readByte();
        this.write(dest, this.read(left) ?? this.read(right));
    },
    GET_ITERATOR: function () {
        const dest = this.readByte(), src = this.readByte();
        this.write(dest, this.read(src)[Symbol.iterator]());
    },
    ITERATOR_NEXT: function () {
        const dest = this.readByte(), iterator = this.readByte();
        const next = this.read(iterator).next();
        this.write(dest, next);
    },
    ITERATOR_DONE: function () {
        const dest = this.readByte(), iterator = this.readByte();
        this.write(dest, this.read(iterator).done);
    },
    ITERATOR_VALUE: function () {
        const dest = this.readByte(), iterator = this.readByte();
        this.write(dest, this.read(iterator).value);
    },
    GET_PROPERTIES: function () {
        const dest = this.readByte(), src = this.readByte();
        const res = Object.getOwnPropertyNames(this.read(src))
        if (this.read(src) instanceof Array) {
            res.pop()
        }
        this.write(dest, res);
    },
    NOP: function () {
    },
    END: function () {
    },
    PRINT: function () {
        console.log(this.read(this.readByte()));
    }
};

// --- Dispatch Loop Obfuscation ---
// Phase constants for obfuscated dispatch loop
const PHASE_FETCH = 0;
const PHASE_DECODE = 1;
const PHASE_PRE_EXEC = 2;
const PHASE_EXECUTE = 3;
const PHASE_POST = 4;
const PHASE_DUMMY = 5;
const PHASE_END = 6;

function createDispatchObfuscationProfile(key) {
    const normalizedKey = String(key ?? "");
    let seed = 0x243f6a88;
    for (let i = 0; i < normalizedKey.length; i++) {
        seed = Math.imul((seed ^ normalizedKey.charCodeAt(i)) >>> 0, 0x1bbcd9b5) >>> 0;
    }

    // Real phases in execution order (must stay ordered)
    const realPhases = [PHASE_FETCH, PHASE_DECODE, PHASE_PRE_EXEC, PHASE_EXECUTE, PHASE_POST];
    const realCount = realPhases.length;
    // Insert 2-4 dummy phases per cycle at random positions
    const dummyCount = 2 + (seed % 3);
    const totalSlots = realCount + dummyCount;

    // Build the phase table: place dummies at seeded random positions, real phases in order
    const phaseTable = [];

    // Determine which positions get dummies
    const dummyPositions = new Set();
    let s = seed;
    while (dummyPositions.size < dummyCount) {
        s = Math.imul(s ^ (s >>> 16), 0x45d9f3b) >>> 0;
        const pos = s % totalSlots;
        dummyPositions.add(pos);
    }

    // Build table: dummies at their positions, real phases fill remaining slots in order
    let realIdx = 0;
    for (let i = 0; i < totalSlots; i++) {
        if (dummyPositions.has(i)) {
            phaseTable.push(PHASE_DUMMY);
        } else {
            phaseTable.push(realPhases[realIdx++]);
        }
    }

    return {
        phaseTable,
        totalSlots,
        seed,
    };
}

module.exports = {
    BYTECODE_INTEGRITY_PREFIX,
    BYTECODE_ENCRYPTED_PREFIX,
    bytecodeKeyRegistry,
    rotateLeft,
    createBytecodeIntegrityDigest,
    createSeedFromString,
    createSeededPermutation,
    encodeStatefulOpcode,
    decodeStatefulOpcode,
    deriveOpcodeStateSeed,
    deriveJumpTargetSeed,
    deriveRuntimeDispatchSeed,
    deriveAntiDebugSeed,
    deriveInstructionByteSeed,
    deriveNestedKey,
    deriveInnerShuffleSeed,
    createOpcodePositionMask,
    createJumpTargetByteMask,
    createInstructionByteMask,
    isBase64Like,
    normalizeEnvelopeFlags,
    DISPATCHER_VARIANTS,
    RUNTIME_OPCODE_DERIVATION_MODES,
    clampInteger,
    interleaveDispatchDecoys,
    buildDispatchEntries,
    deriveAliasIndex,
    mixRuntimeOpcodeState,
    resolveRegisteredBytecodeKey,
    createAntiDebugState,
    cloneAntiDebugState,
    createMemoryProtectionState,
    createRegisterProtectionMask,
    createProtectedRegisterValue,
    createRegisterReference,
    restoreProtectedRegisterValue,
    copyBuffer,
    toUint8Array,
    registerNames,
    opNames,
    reservedNames,
    registers,
    opcodes,
    implOpcode,
    DEFAULT_VM_PROFILE,
    normalizeVMProfile,
    PHASE_FETCH,
    PHASE_DECODE,
    PHASE_PRE_EXEC,
    PHASE_EXECUTE,
    PHASE_POST,
    PHASE_DUMMY,
    PHASE_END,
    createDispatchObfuscationProfile
};
