/**
 * Copyright (c) 2026 Bivex
 *
 * Author: Bivex
 * Available for contact via email: support@b-b.top
 * For up-to-date contact information:
 * https://github.com/bivex
 *
 * Created: 2026-03-26 18:43
 * Last Updated: 2026-03-26 18:54
 *
 * Licensed under the MIT License.
 * Commercial licensing available upon request.
 */

const vmCommon = require("./utils/vmCommon");
const {
    BYTECODE_INTEGRITY_PREFIX,
    BYTECODE_ENCRYPTED_PREFIX,
    bytecodeKeyRegistry,
    registers,
    opcodes,
    opNames,
    registerNames,
    reservedNames,
    implOpcode,
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
    createOpcodePositionMask,
    createJumpTargetByteMask,
    createInstructionByteMask,
    isBase64Like,
    normalizeEnvelopeFlags,
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
} = vmCommon;

const { createTimeLockState, solveTimeLock, verifyTimeLock } = require("./utils/timeLock");
const { whiteboxDecrypt, whiteboxEncrypt } = require("./utils/whiteboxCipher");

const whiteboxTableRegistry = new Map();

const {log, LogData} = require("./utils/log");
const zlib = require("node:zlib");

// Node-specific: Buffer-based cipher (vm_dist uses Uint8Array variant)
function createBytecodeCipherBuffer(input, key, salt) {
    const normalizedKey = String(key ?? "");
    if (!normalizedKey) {
        throw new Error("VM decryption key not available");
    }

    const normalizedSalt = String(salt ?? "");
    const data = Buffer.isBuffer(input) ? input : Buffer.from(input);
    const output = Buffer.alloc(data.length);
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

// Node-specific: Buffer-based transforms
function transformJumpTargetBytes(input, position, seed) {
    const data = Buffer.isBuffer(input) ? Buffer.from(input) : Buffer.from(input);

    for (let index = 0; index < data.length; index++) {
        data[index] ^= createJumpTargetByteMask(seed >>> 0, (position + index) >>> 0);
    }

    return data;
}

function transformInstructionBytes(input, instructionPosition, seed) {
    const data = Buffer.isBuffer(input) ? Buffer.from(input) : Buffer.from(input);

    for (let index = 0; index < data.length; index++) {
        data[index] ^= createInstructionByteMask(seed >>> 0, instructionPosition >>> 0, (instructionPosition + 1 + index) >>> 0);
    }

    return data;
}

// Node-specific: Buffer-based envelope unpacking
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
        let decryptedData = createBytecodeCipherBuffer(Buffer.from(payload, "base64"), decryptionKey, salt);
        if (flags.includes("W")) {
            const tables = whiteboxTableRegistry.get(keyId);
            if (tables) {
                decryptedData = whiteboxDecrypt(decryptedData, tables.inverse, decryptionKey);
            }
        }
        const decryptedPayload = decryptedData.toString("utf8");

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

// compiler is expected to load all dependencies into registers prior to future execution
// a JSVM instance. a new one should be created for every virtualized function so that they are able to run concurrently without interfering with each other
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
        this.antiDump = false
        this.antiDumpSeed = 0
        this.antiDumpHighWaterMark = 0
        this.antiDumpBackup = null
        this.registers[registers.INSTRUCTION_POINTER] = 0
        this.registers[registers.UNDEFINED] = undefined
        this.registers[registers.VOID] = 0
        Object.keys(opcodes).forEach((opcode) => {
            this.opcodes[opcodes[opcode]] = implOpcode[opcode].bind(this)
        })
        // Wrap jump handlers with self-modifying bytecode restore logic
        const jumpOpcodeNames = ["JUMP_UNCONDITIONAL", "JUMP_EQ", "JUMP_NOT_EQ", "MACRO_TEST_JUMP_EQ", "MACRO_TEST_JUMP_NOT_EQ"]
        for (const name of jumpOpcodeNames) {
            const originalHandler = this.opcodes[opcodes[name]]
            if (originalHandler) {
                const vm = this
                this.opcodes[opcodes[name]] = () => {
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

    static createEncryptedBytecodeEnvelope(code, format, integrityKey, keyId, bytecodeKey, salt, flags = "S", whiteboxTables = null) {
        const normalizedSalt = String(salt ?? "");
        const normalizedKeyId = String(keyId ?? "");
        const normalizedFlags = normalizeEnvelopeFlags(flags);
        let rawData = Buffer.from(String(code ?? ""), "utf8");
        if (whiteboxTables) {
            rawData = whiteboxEncrypt(rawData, whiteboxTables.forward, bytecodeKey);
        }
        const encryptedPayload = createBytecodeCipherBuffer(rawData, bytecodeKey, normalizedSalt).toString("base64");
        const digest = createBytecodeIntegrityDigest(`${normalizedKeyId}:${normalizedFlags}:${encryptedPayload}`, normalizedSalt, integrityKey, format);
        return `${BYTECODE_ENCRYPTED_PREFIX}:${normalizedSalt}:${normalizedKeyId}:${normalizedFlags}:${digest}:${encryptedPayload}`;
    }

    static registerBytecodeKey(keyId, key) {
        bytecodeKeyRegistry.set(String(keyId ?? ""), String(key ?? ""));
        return this
    }

    static setWhiteboxTables(keyId, tables) {
        whiteboxTableRegistry.set(String(keyId ?? ""), tables);
        return this
    }

    static deriveOpcodeStateSeed(key) {
        return deriveOpcodeStateSeed(key)
    }

    static deriveJumpTargetSeed(key) {
        return deriveJumpTargetSeed(key)
    }

    static deriveInstructionByteSeed(key) {
        return deriveInstructionByteSeed(key)
    }

    static encodeStatefulOpcode(opcode, position, seed) {
        return encodeStatefulOpcode(opcode, position, seed)
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
        this.antiDebugState = cloneAntiDebugState(state)
        return this
    }

    enableAntiDebug(key) {
        this.antiDebugState = createAntiDebugState(key)
        this.runtimeOpcodeState = mixRuntimeOpcodeState(this.runtimeOpcodeState || this.runtimeDispatchSeed || 0x4f1bbcdc, this.antiDebugState.seed & 0xFF, 0, this.antiDebugState.seed)
        return this
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

    enableAntiDump(key) {
        this.antiDump = true
        const normalizedKey = String(key ?? "")
        let seed = 0x6a09e667
        for (let i = 0; i < normalizedKey.length; i++) {
            seed = Math.imul((seed ^ normalizedKey.charCodeAt(i)) >>> 0, 0x1bbcd9b5) >>> 0
        }
        this.antiDumpSeed = seed
        return this
    }

    scrubBytecodeRange(fromPos, toPos) {
        if (!this.code || toPos <= fromPos) return
        for (let i = fromPos; i < toPos; i++) {
            const mask = ((this.antiDumpSeed ^ Math.imul(i + 1, 0x85ebca6b)) >>> 0) & 0xFF
            this.code[i] = mask
        }
    }

    enableTimeLock(key) {
        this.timeLockState = createTimeLockState(key)
        return this
    }

    solveTimeLockChallenge() {
        if (!this.timeLockState) return
        const solutionHash = solveTimeLock(this.timeLockState)
        this.runtimeOpcodeState = mixRuntimeOpcodeState(
            this.runtimeOpcodeState || this.runtimeDispatchSeed || 0x4f1bbcdc,
            solutionHash & 0xFF,
            (solutionHash >>> 8) & 0xFF,
            solutionHash >>> 16
        )
    }

    enableDispatchObfuscation(key) {
        this.dispatchObfuscationProfile = createDispatchObfuscationProfile(key)
        return this
    }

    runAntiDebugSweep(position) {
        if (!this.antiDebugState || !this.antiDebugState.enabled) {
            return
        }

        const state = this.antiDebugState
        const now = Date.now()

        if (state.lastStepAt && now - state.lastStepAt > state.pauseThresholdMs && state.instructionCount > 4) {
            state.suspicionScore += 1
        }

        if (typeof window !== "undefined" && window) {
            const widthDelta = Math.abs((window.outerWidth ?? 0) - (window.innerWidth ?? 0))
            const heightDelta = Math.abs((window.outerHeight ?? 0) - (window.innerHeight ?? 0))
            if (widthDelta > state.devtoolsThreshold || heightDelta > state.devtoolsThreshold) {
                state.suspicionScore += 1
            }
            if (state.suspicionScore >= 2 && globalThis.__JSV_DISABLE_DEBUG_TRAPS__ !== true) {
                try {
                    Function("debugger")()
                    state.disruptionCount += 1
                } catch (error) {
                    // ignore
                }
            }
        }

        state.instructionCount += 1
        state.lastStepAt = now

        if (state.suspicionScore > state.appliedSuspicion) {
            this.runtimeOpcodeState = mixRuntimeOpcodeState(this.runtimeOpcodeState || this.runtimeDispatchSeed || 0x4f1bbcdc, state.seed & 0xFF, position, state.suspicionScore)
            state.appliedSuspicion = state.suspicionScore
        }
    }

    advanceRuntimeOpcodeState(opcode, position) {
        this.runtimeOpcodeState = mixRuntimeOpcodeState(
            this.runtimeOpcodeState || this.runtimeDispatchSeed || 0x4f1bbcdc,
            opcode,
            position,
            this.antiDebugState ? this.antiDebugState.suspicionScore : 0
        )
    }

    adoptMemoryProtectionState(state) {
        this.memoryProtectionState = state ?? null
        return this
    }

    enableMemoryProtection(key) {
        const existingValues = []
        for (let register = registerNames.length; register < this.registers.length; register++) {
            existingValues.push({
                register,
                value: this.readStored(register)
            })
        }
        this.memoryProtectionState = createMemoryProtectionState(key, this.registers.length - registerNames.length)
        existingValues.forEach(({register, value}) => {
            if (value !== null) {
                this.registers[register] = createProtectedRegisterValue(this.memoryProtectionState, register, value)
            }
        })
        return this
    }

    isProtectedRegister(register) {
        return !!(this.memoryProtectionState && this.memoryProtectionState.enabled && register >= registerNames.length)
    }

    rotateProtectedRegisters() {
        if (!this.memoryProtectionState || !this.memoryProtectionState.enabled) {
            return this
        }

        for (let register = registerNames.length; register < this.registers.length; register++) {
            if (this.registerRefs.has(register)) {
                continue
            }

            const storedValue = this.registers[register]
            if (storedValue === null) {
                continue
            }

            const resolvedValue = restoreProtectedRegisterValue(this.memoryProtectionState, register, storedValue, {
                consume: storedValue && storedValue.__jsvmProtected === true
            })
            this.registers[register] = createProtectedRegisterValue(this.memoryProtectionState, register, resolvedValue)
        }

        return this
    }

    captureRegisterSnapshot() {
        if (!this.memoryProtectionState || !this.memoryProtectionState.enabled) {
            return this.registers.slice()
        }

        const snapshot = this.registers.slice()
        for (let register = registerNames.length; register < snapshot.length; register++) {
            if (this.registerRefs.has(register)) {
                continue
            }

            const resolvedValue = this.readStored(register)
            snapshot[register] = resolvedValue === null ? null : createProtectedRegisterValue(this.memoryProtectionState, register, resolvedValue)
        }

        return snapshot
    }

    releaseRegisterSnapshot(snapshot, preservedRegisters = []) {
        if (!this.memoryProtectionState || !this.memoryProtectionState.enabled || !snapshot) {
            return this
        }

        const preserved = new Set(preservedRegisters)
        for (let register = registerNames.length; register < snapshot.length; register++) {
            if (preserved.has(register)) {
                continue
            }
            const storedValue = snapshot[register]
            if (storedValue && storedValue.__jsvmProtected === true) {
                restoreProtectedRegisterValue(this.memoryProtectionState, register, storedValue, {consume: true})
            }
        }

        return this
    }

    readStored(register) {
        if (!this.isProtectedRegister(register)) {
            return this.registers[register]
        }
        const resolvedValue = restoreProtectedRegisterValue(this.memoryProtectionState, register, this.registers[register], {
            consume: true
        })
        this.registers[register] = createProtectedRegisterValue(this.memoryProtectionState, register, resolvedValue)
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
            })
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
        const position = this.read(registers.INSTRUCTION_POINTER)
        const byte = this.code[position]
        this.registers[registers.INSTRUCTION_POINTER] = position + 1;
        return byte
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
            return byte ^ createInstructionByteMask(this.instructionByteSeed >>> 0, this.currentInstructionBase >>> 0, position >>> 0)
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
        // log(`Read boolean: ${bool}`)
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
            // these should be registers to loaded values
            array.push(this.read(this.readByte()))
        }
        log(`Read array of length ${length}: ${array}`)
        return array
    }

    // js integers are 32-bit signed
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

    readJumpTargetDWORD() {
        const position = this.read(registers.INSTRUCTION_POINTER)
        const bytes = Buffer.from([
            this.readByte(),
            this.readByte(),
            this.readByte(),
            this.readByte()
        ])

        if (!this.jumpTargetEncodingEnabled || !this.jumpTargetSeed) {
            // Use endianness from profile
            return this.vmProfile.polyEndian === "LE"
                ? bytes.readInt32LE(0)
                : bytes.readInt32BE(0)
        }

        const transformed = transformJumpTargetBytes(bytes, position, this.jumpTargetSeed)
        return this.vmProfile.polyEndian === "LE"
            ? transformed.readInt32LE(0)
            : transformed.readInt32BE(0)
    }

    // taken from: https://github.com/jwillbold/rusty-jsyc/blob/master/vm/vm.js#L403
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
                // exponent and significand are zero
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
        log(`Read float: ${sign * significand * Math.pow(2, exponent)}`)
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
            // assume buffer
            this.code = code
        } else {
            const buffer = Buffer.from(code, format)
            if (envelope.encrypted) {
                try {
                    this.code = zlib.inflateSync(buffer)
                } catch (error) {
                    throw new Error("VM bytecode decryption failed")
                }
            } else if (buffer[0] === 0x78 && buffer[1] === 0x9c) {
                log(new LogData("Decompressing zlib compressed bytecode", 'accent', true))
                this.code = zlib.inflateSync(buffer)
            } else {
                this.code = buffer
            }
        }
        if (this.selfModifyingBytecode && this.code) {
            this.codeBackup = Buffer.alloc(this.code.length)
            for (let i = 0; i < this.code.length; i++) {
                const mask = ((this.selfModifySeed ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0) & 0xFF
                this.codeBackup[i] = this.code[i] ^ mask
            }
        }
    }

    loadDependencies(dependencies) {
        Object.keys(dependencies).forEach((key) => {
            log(`Loading dependency to register ${key}: ${dependencies[key]}`)
            this.write(parseInt(key), dependencies[key])
        })
    }

    // --- Dispatch Loop Obfuscation: Phase Handlers ---

    _phaseFetch() {
        this._tl_opcodeResult = this.readOpcode()
    }

    _phaseDecode() {
        const {opcode, position} = this._tl_opcodeResult
        if (opcode === undefined || opNames[opcode] === "END") {
            this._tl_opcodeResult._end = true
            if (this.antiDump && position !== undefined && this.code) {
                this.scrubBytecodeRange(this.antiDumpHighWaterMark, position)
            }
            this.currentInstructionBase = null
            return
        }
        this._tl_opcodeResult._end = false
        this.runAntiDebugSweep(position)
        this._tl_handler = this.resolveOpcodeHandler(opcode, position)
    }

    _phasePreExec() {
        if (this._tl_opcodeResult._end) return
        const {opcode, position} = this._tl_opcodeResult
        if (!this._tl_handler) {
            log(`[IP = ${this.read(registers.INSTRUCTION_POINTER) - 1}]: Unknown opcode ${opcode}`)
            this.advanceRuntimeOpcodeState(opcode, position)
            this.rotateProtectedRegisters()
            this.currentInstructionBase = null
            this._tl_opcodeResult._nop = true
        } else {
            this._tl_opcodeResult._nop = false
            log(`[IP = ${position}]: Executing ${opNames[opcode]}`)
        }
    }

    _phaseExecute() {
        if (this._tl_opcodeResult._end || this._tl_opcodeResult._nop) return
        this._tl_handler()
    }

    _phasePostExec() {
        if (this._tl_opcodeResult._nop) return
        const {opcode, position} = this._tl_opcodeResult
        this.advanceRuntimeOpcodeState(opcode, position)
        this.rotateProtectedRegisters()
        if (this.selfModifyingBytecode && position !== undefined && this.code) {
            const currentIP = this.read(registers.INSTRUCTION_POINTER)
            this.scrambleInstruction(position, currentIP)
        }
        if (this.antiDump && position !== undefined && this.code) {
            const currentIP = this.read(registers.INSTRUCTION_POINTER)
            const scrubEnd = Math.min(currentIP, this.code.length)
            this.scrubBytecodeRange(this.antiDumpHighWaterMark, scrubEnd)
            if (scrubEnd > this.antiDumpHighWaterMark) {
                this.antiDumpHighWaterMark = scrubEnd
            }
        }
        this.currentInstructionBase = null
    }

    _phaseDummy() {
        this.runtimeOpcodeState = Math.imul(
            (this.runtimeOpcodeState ^ (this.runtimeOpcodeState >>> 8)) >>> 0,
            0x45d9f3b
        ) >>> 0
    }

    run() {
        this.executionMode = "sync"
        if (this.timeLockState) this.solveTimeLockChallenge()

        if (this.dispatchObfuscationProfile) {
            const profile = this.dispatchObfuscationProfile
            const phases = [
                () => this._phaseFetch(),
                () => this._phaseDecode(),
                () => this._phasePreExec(),
                () => this._phaseExecute(),
                () => this._phasePostExec(),
                () => this._phaseDummy(),
            ]
            while (true) {
                for (let i = 0; i < profile.totalSlots; i++) {
                    phases[profile.phaseTable[i]]()
                    if (profile.phaseTable[i] === PHASE_DECODE && this._tl_opcodeResult._end) return
                }
            }
        }

        while (true) {
            const {opcode, position} = this.readOpcode()
            if (opcode === undefined || opNames[opcode] === "END") {
                log(`[IP = ${this.read(registers.INSTRUCTION_POINTER) - 1}]: End of execution`)
                if (this.antiDump && position !== undefined && this.code) {
                    this.scrubBytecodeRange(this.antiDumpHighWaterMark, position)
                }
                this.currentInstructionBase = null
                break
            }
            this.runAntiDebugSweep(position)
            const handler = this.resolveOpcodeHandler(opcode, position)
            if (!handler) {
                log(`[IP = ${this.read(registers.INSTRUCTION_POINTER) - 1}]: Unknown opcode ${opcode}`)
                this.advanceRuntimeOpcodeState(opcode, position)
                this.rotateProtectedRegisters()
                this.currentInstructionBase = null
                continue
            }
            log(`[IP = ${position}]: Executing ${opNames[opcode]}`)
            try {
                handler()
            } catch (e) {
                log(`${e.toString()} at IP = ${this.read(registers.INSTRUCTION_POINTER)}`)
                throw e
            } finally {
                this.advanceRuntimeOpcodeState(opcode, position)
                this.rotateProtectedRegisters()
                if (this.selfModifyingBytecode && position !== undefined && this.code) {
                    const currentIP = this.read(registers.INSTRUCTION_POINTER)
                    this.scrambleInstruction(position, currentIP)
                }
                if (this.antiDump && position !== undefined && this.code) {
                    const currentIP = this.read(registers.INSTRUCTION_POINTER)
                    const scrubEnd = Math.min(currentIP, this.code.length)
                    this.scrubBytecodeRange(this.antiDumpHighWaterMark, scrubEnd)
                    if (scrubEnd > this.antiDumpHighWaterMark) {
                        this.antiDumpHighWaterMark = scrubEnd
                    }
                }
                this.currentInstructionBase = null
            }
        }
    }

    async runAsync() {
        this.executionMode = "async"
        if (this.timeLockState) this.solveTimeLockChallenge()

        if (this.dispatchObfuscationProfile) {
            const profile = this.dispatchObfuscationProfile
            const phases = [
                () => this._phaseFetch(),
                () => this._phaseDecode(),
                () => this._phasePreExec(),
                () => this._phaseExecute(),
                async () => { await this._tl_handler() },
                () => this._phasePostExec(),
                () => this._phaseDummy(),
            ]
            while (true) {
                for (let i = 0; i < profile.totalSlots; i++) {
                    await phases[profile.phaseTable[i]]()
                    if (profile.phaseTable[i] === PHASE_DECODE && this._tl_opcodeResult._end) return
                }
            }
        }

        while (true) {
            const {opcode, position} = this.readOpcode()
            if (opcode === undefined || opNames[opcode] === "END") {
                log(`[IP = ${this.read(registers.INSTRUCTION_POINTER) - 1}]: End of execution`)
                if (this.antiDump && position !== undefined && this.code) {
                    this.scrubBytecodeRange(this.antiDumpHighWaterMark, position)
                }
                this.currentInstructionBase = null
                break
            }
            this.runAntiDebugSweep(position)
            const handler = this.resolveOpcodeHandler(opcode, position)
            if (!handler) {
                log(`[IP = ${this.read(registers.INSTRUCTION_POINTER) - 1}]: Unknown opcode ${opcode}`)
                this.advanceRuntimeOpcodeState(opcode, position)
                this.rotateProtectedRegisters()
                this.currentInstructionBase = null
                continue
            }
            log(`[IP = ${position}]: Executing ${opNames[opcode]}`)
            try {
                await handler()
            } catch (e) {
                log(`${e.toString()} at IP = ${this.read(registers.INSTRUCTION_POINTER)}`)
                throw e
            } finally {
                this.advanceRuntimeOpcodeState(opcode, position)
                this.rotateProtectedRegisters()
                if (this.selfModifyingBytecode && position !== undefined && this.code) {
                    const currentIP = this.read(registers.INSTRUCTION_POINTER)
                    this.scrambleInstruction(position, currentIP)
                }
                if (this.antiDump && position !== undefined && this.code) {
                    const currentIP = this.read(registers.INSTRUCTION_POINTER)
                    const scrubEnd = Math.min(currentIP, this.code.length)
                    this.scrubBytecodeRange(this.antiDumpHighWaterMark, scrubEnd)
                    if (scrubEnd > this.antiDumpHighWaterMark) {
                        this.antiDumpHighWaterMark = scrubEnd
                    }
                }
                this.currentInstructionBase = null
            }
        }
    }
}

module.exports = JSVM
