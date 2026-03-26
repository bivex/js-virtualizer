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

function unpackBytecodeEnvelope(code, format, key) {
    if (typeof code !== "string" || !code.startsWith(`${BYTECODE_INTEGRITY_PREFIX}:`)) {
        return code;
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

    return payload;
}

// compiler is expected to load all dependencies into registers prior to future execution
// a JSVM instance. a new one should be created for every virtualized function so that they are able to run concurrently without interfering with each other
class JSVM {
    constructor() {
        this.registers = new Array(256).fill(null)
        this.regstack = []
        this.opcodes = {}
        this.code = null
        this.bytecodeIntegrityKey = ""
        this.registers[registers.INSTRUCTION_POINTER] = 0
        this.registers[registers.UNDEFINED] = undefined
        this.registers[registers.VOID] = 0
        Object.keys(opcodes).forEach((opcode) => {
            this.opcodes[opcodes[opcode]] = implOpcode[opcode].bind(this)
        })
    }

    static createBytecodeIntegrityDigest(code, salt, key, format) {
        return createBytecodeIntegrityDigest(code, salt, key, format)
    }

    static createBytecodeIntegrityEnvelope(code, format, key, salt) {
        const normalizedSalt = String(salt ?? "");
        const digest = createBytecodeIntegrityDigest(code, normalizedSalt, key, format);
        return `${BYTECODE_INTEGRITY_PREFIX}:${normalizedSalt}:${digest}:${code}`;
    }

    setBytecodeIntegrityKey(key) {
        this.bytecodeIntegrityKey = String(key ?? "")
        return this
    }

    read(register) {
        return this.registers[register]
    }

    write(register, value) {
        if (reservedNames.has(registerNames[register])) {
            throw new Error(`Tried to modify reserved register: ${registerNames[register]} (${register})`)
        }
        this.registers[register] = value
    }

    readByte() {
        const byte = this.code[this.read(registers.INSTRUCTION_POINTER)]
        this.registers[registers.INSTRUCTION_POINTER] += 1;
        // log(`Read byte (IP = ${registers.INSTRUCTION_POINTER - 1}): ${byte.toString(16)}`)
        return byte
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
            str += String.fromCharCode(this.readByte())
        }
        return str
    }

    loadFromString(code, format) {
        code = unpackBytecodeEnvelope(code, format, this.bytecodeIntegrityKey)
        if (!format) {
            // assume buffer
            this.code = code
            return
        }
        const buffer = Buffer.from(code, format)
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
        while (true) {
            const opcode = this.readByte()
            if (opcode === undefined || opNames[opcode] === "END") {
                // treat as end
                log(`[IP = ${this.read(registers.INSTRUCTION_POINTER) - 1}]: End of execution`)
                break
            }
            if (!this.opcodes[opcode]) {
                log(`[IP = ${this.read(registers.INSTRUCTION_POINTER) - 1}]: Unknown opcode ${opcode}`)
                // treat as NOP
                continue
            }
            log(`[IP = ${this.read(registers.INSTRUCTION_POINTER) - 1}]: Executing ${opNames[opcode]}`)
            try {
                this.opcodes[opcode]()
            } catch (e) {
                log(`${e.toString()} at IP = ${this.read(registers.INSTRUCTION_POINTER)}`)
                throw e
            }
        }
    }

    async runAsync() {
        while (true) {
            const opcode = this.readByte()
            if (opcode === undefined || opNames[opcode] === "END") {
                // treat as end
                log(`[IP = ${this.read(registers.INSTRUCTION_POINTER) - 1}]: End of execution`)
                break
            }
            if (!this.opcodes[opcode]) {
                log(`[IP = ${this.read(registers.INSTRUCTION_POINTER) - 1}]: Unknown opcode ${opcode}`)
                // treat as NOP
                continue
            }
            log(`[IP = ${this.read(registers.INSTRUCTION_POINTER) - 1}]: Executing ${opNames[opcode]}`)
            try {
                await this.opcodes[opcode]()
            } catch (e) {
                log(`${e.toString()} at IP = ${this.read(registers.INSTRUCTION_POINTER)}`)
                throw e
            }
        }
    }
}

module.exports = JSVM
