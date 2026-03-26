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

const {registers, opcodes, opNames, registerNames, reservedNames} = require("./utils/constants");
const implOpcode = require("./utils/opcodes");
const {log, LogData} = require("./utils/log");
const zlib = require("node:zlib");

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

function deriveOpcodeStateSeed(key) {
    return createSeedFromString(`opcode:${String(key ?? "")}`, 0x6d2b79f5) || 0x6d2b79f5;
}

function createOpcodePositionMask(seed, position) {
    let state = (seed ^ Math.imul((position + 1) >>> 0, 0x9e3779b1)) >>> 0;
    state = rotateLeft(state, position % 23 + 5);
    state ^= state >>> 16;
    return state & 0xFF;
}

function encodeStatefulOpcode(opcode, position, seed) {
    return (opcode ^ createOpcodePositionMask(seed >>> 0, position >>> 0)) & 0xFF;
}

function decodeStatefulOpcode(opcode, position, seed) {
    return encodeStatefulOpcode(opcode, position, seed);
}

function isBase64Like(value) {
    return typeof value === "string" && /^[A-Za-z0-9+/=]+$/.test(value);
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

function unpackBytecodeEnvelope(code, format, key) {
    if (typeof code !== "string") {
        return {
            payload: code,
            encrypted: false,
            statefulOpcodes: false
        };
    }

    if (code.startsWith(`${BYTECODE_ENCRYPTED_PREFIX}:`)) {
        const start = BYTECODE_ENCRYPTED_PREFIX.length + 1;
        const saltEnd = code.indexOf(":", start);
        const keyIdEnd = saltEnd === -1 ? -1 : code.indexOf(":", saltEnd + 1);
        const digestEnd = keyIdEnd === -1 ? -1 : code.indexOf(":", keyIdEnd + 1);

        if (saltEnd === -1 || keyIdEnd === -1 || digestEnd === -1) {
            throw new Error("Malformed protected bytecode envelope");
        }

        const salt = code.slice(start, saltEnd);
        const keyId = code.slice(saltEnd + 1, keyIdEnd);
        const expectedDigest = code.slice(keyIdEnd + 1, digestEnd);
        const payload = code.slice(digestEnd + 1);
        const actualDigest = createBytecodeIntegrityDigest(`${keyId}:${payload}`, salt, key, format);

        if (expectedDigest !== actualDigest) {
            throw new Error("Bytecode integrity check failed");
        }

        const decryptionKey = resolveRegisteredBytecodeKey(keyId);
        const decryptedPayload = createBytecodeCipherBuffer(Buffer.from(payload, "base64"), decryptionKey, salt).toString("utf8");

        if (format === "base64" && !isBase64Like(decryptedPayload)) {
            throw new Error("VM bytecode decryption failed");
        }

        return {
            payload: decryptedPayload,
            encrypted: true,
            statefulOpcodes: true
        };
    }

    if (!code.startsWith(`${BYTECODE_INTEGRITY_PREFIX}:`)) {
        return {
            payload: code,
            encrypted: false,
            statefulOpcodes: false
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
        statefulOpcodes: false
    };
}

function createMemoryProtectionState(key) {
    const normalizedKey = String(key ?? "");
    let seed = 0x9e3779b9;

    for (let i = 0; i < normalizedKey.length; i++) {
        seed = Math.imul((seed ^ normalizedKey.charCodeAt(i)) >>> 0, 0x45d9f3b) >>> 0;
    }

    return {
        enabled: true,
        seed,
        heap: new Map(),
        nextToken: 1
    };
}

function createRegisterProtectionMask(seed, register) {
    return rotateLeft((seed ^ Math.imul(register + 1, 0x9e3779b1)) >>> 0, register % 29 + 3);
}

function createProtectedRegisterValue(state, register, value) {
    const token = state.nextToken++;
    state.heap.set(token, value);

    const maskedToken = (token ^ createRegisterProtectionMask(state.seed, register)) >>> 0;
    const guard = rotateLeft((maskedToken ^ state.seed ^ register) >>> 0, 11);

    return Object.freeze({
        __jsvmProtected: true,
        token: maskedToken,
        guard
    });
}

function restoreProtectedRegisterValue(state, register, value) {
    if (!value || value.__jsvmProtected !== true) {
        return value;
    }

    const expectedGuard = rotateLeft((value.token ^ state.seed ^ register) >>> 0, 11);
    if (value.guard !== expectedGuard) {
        throw new Error("VM register protection check failed");
    }

    const token = (value.token ^ createRegisterProtectionMask(state.seed, register)) >>> 0;
    if (!state.heap.has(token)) {
        throw new Error("VM register protection token missing");
    }

    return state.heap.get(token);
}

function createRegisterReference(value) {
    return {
        value
    };
}

// compiler is expected to load all dependencies into registers prior to future execution
// a JSVM instance. a new one should be created for every virtualized function so that they are able to run concurrently without interfering with each other
class JSVM {
    constructor() {
        this.registers = new Array(256).fill(null)
        this.regstack = []
        this.opcodes = {}
        this.dispatchHandlers = []
        this.dispatchLookup = []
        this.code = null
        this.bytecodeIntegrityKey = ""
        this.opcodeStateSeed = 0
        this.statefulOpcodesEnabled = false
        this.memoryProtectionState = null
        this.registerRefs = new Map()
        this.executionMode = "sync"
        this.registers[registers.INSTRUCTION_POINTER] = 0
        this.registers[registers.UNDEFINED] = undefined
        this.registers[registers.VOID] = 0
        Object.keys(opcodes).forEach((opcode) => {
            this.opcodes[opcodes[opcode]] = implOpcode[opcode].bind(this)
        })
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

    static createEncryptedBytecodeEnvelope(code, format, integrityKey, keyId, bytecodeKey, salt) {
        const normalizedSalt = String(salt ?? "");
        const normalizedKeyId = String(keyId ?? "");
        const encryptedPayload = createBytecodeCipherBuffer(Buffer.from(String(code ?? ""), "utf8"), bytecodeKey, normalizedSalt).toString("base64");
        const digest = createBytecodeIntegrityDigest(`${normalizedKeyId}:${encryptedPayload}`, normalizedSalt, integrityKey, format);
        return `${BYTECODE_ENCRYPTED_PREFIX}:${normalizedSalt}:${normalizedKeyId}:${digest}:${encryptedPayload}`;
    }

    static registerBytecodeKey(keyId, key) {
        bytecodeKeyRegistry.set(String(keyId ?? ""), String(key ?? ""));
        return this
    }

    static deriveOpcodeStateSeed(key) {
        return deriveOpcodeStateSeed(key)
    }

    static encodeStatefulOpcode(opcode, position, seed) {
        return encodeStatefulOpcode(opcode, position, seed)
    }

    refreshDispatchTable() {
        const permutation = createSeededPermutation(opNames.length, this.opcodeStateSeed || 0x9e3779b9);
        this.dispatchHandlers = new Array(opNames.length);
        this.dispatchLookup = new Array(opNames.length);

        for (let slot = 0; slot < permutation.length; slot++) {
            const opcode = permutation[slot];
            this.dispatchLookup[opcode] = slot;
            this.dispatchHandlers[slot] = this.opcodes[opcode];
        }
    }

    setBytecodeIntegrityKey(key) {
        this.bytecodeIntegrityKey = String(key ?? "")
        this.opcodeStateSeed = this.bytecodeIntegrityKey ? deriveOpcodeStateSeed(this.bytecodeIntegrityKey) : 0
        this.refreshDispatchTable()
        return this
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
        this.memoryProtectionState = createMemoryProtectionState(key)
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

    readStored(register) {
        if (!this.isProtectedRegister(register)) {
            return this.registers[register]
        }
        return restoreProtectedRegisterValue(this.memoryProtectionState, register, this.registers[register])
    }

    writeStored(register, value) {
        if (reservedNames.has(registerNames[register])) {
            throw new Error(`Tried to modify reserved register: ${registerNames[register]} (${register})`)
        }
        if (!this.isProtectedRegister(register)) {
            this.registers[register] = value
            return
        }
        this.registers[register] = createProtectedRegisterValue(this.memoryProtectionState, register, value)
    }

    getOrCreateRegisterReference(register) {
        if (this.registerRefs.has(register)) {
            return this.registerRefs.get(register)
        }
        const reference = createRegisterReference(this.readStored(register))
        this.registerRefs.set(register, reference)
        return reference
    }

    bindRegisterReference(register, reference) {
        this.registerRefs.set(register, reference)
        return reference
    }

    detachRegisterReference(register) {
        if (!this.registerRefs.has(register)) {
            return null
        }
        const reference = this.registerRefs.get(register)
        this.writeStored(register, reference.value)
        this.registerRefs.delete(register)
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

    readByte() {
        const byte = this.code[this.read(registers.INSTRUCTION_POINTER)]
        this.registers[registers.INSTRUCTION_POINTER] += 1;
        // log(`Read byte (IP = ${registers.INSTRUCTION_POINTER - 1}): ${byte.toString(16)}`)
        return byte
    }

    readOpcode() {
        const position = this.read(registers.INSTRUCTION_POINTER)
        const opcode = this.readByte()

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

    resolveOpcodeHandler(opcode) {
        const slot = this.dispatchLookup[opcode]
        if (slot === undefined) {
            return null
        }
        return this.dispatchHandlers[slot] ?? null
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
        return this.readByte() << 24 | this.readByte() << 16 | this.readByte() << 8 | this.readByte()
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
        if (!format) {
            // assume buffer
            this.code = code
            return
        }
        const buffer = Buffer.from(code, format)
        if (envelope.encrypted) {
            try {
                this.code = zlib.inflateSync(buffer)
            } catch (error) {
                throw new Error("VM bytecode decryption failed")
            }
            return
        }
        if (buffer[0] === 0x78 && buffer[1] === 0x9c) {
            log(new LogData("Decompressing zlib compressed bytecode", 'accent', true))
            this.code = zlib.inflateSync(buffer)
        } else {
            this.code = buffer
        }
    }

    loadDependencies(dependencies) {
        Object.keys(dependencies).forEach((key) => {
            log(`Loading dependency to register ${key}: ${dependencies[key]}`)
            this.write(parseInt(key), dependencies[key])
        })
    }

    run() {
        this.executionMode = "sync"
        while (true) {
            const {opcode, position} = this.readOpcode()
            if (opcode === undefined || opNames[opcode] === "END") {
                // treat as end
                log(`[IP = ${this.read(registers.INSTRUCTION_POINTER) - 1}]: End of execution`)
                break
            }
            const handler = this.resolveOpcodeHandler(opcode)
            if (!handler) {
                log(`[IP = ${this.read(registers.INSTRUCTION_POINTER) - 1}]: Unknown opcode ${opcode}`)
                // treat as NOP
                continue
            }
            log(`[IP = ${position}]: Executing ${opNames[opcode]}`)
            try {
                handler()
            } catch (e) {
                log(`${e.toString()} at IP = ${this.read(registers.INSTRUCTION_POINTER)}`)
                throw e
            }
        }
    }

    async runAsync() {
        this.executionMode = "async"
        while (true) {
            const {opcode, position} = this.readOpcode()
            if (opcode === undefined || opNames[opcode] === "END") {
                // treat as end
                log(`[IP = ${this.read(registers.INSTRUCTION_POINTER) - 1}]: End of execution`)
                break
            }
            const handler = this.resolveOpcodeHandler(opcode)
            if (!handler) {
                log(`[IP = ${this.read(registers.INSTRUCTION_POINTER) - 1}]: Unknown opcode ${opcode}`)
                // treat as NOP
                continue
            }
            log(`[IP = ${position}]: Executing ${opNames[opcode]}`)
            try {
                await handler()
            } catch (e) {
                log(`${e.toString()} at IP = ${this.read(registers.INSTRUCTION_POINTER)}`)
                throw e
            }
        }
    }
}

module.exports = JSVM
