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
const opNames = ["LOAD_BYTE", "LOAD_BOOL", "LOAD_DWORD", "LOAD_FLOAT", "LOAD_STRING", "LOAD_ARRAY", "LOAD_OBJECT", "SETUP_OBJECT", "SETUP_ARRAY", "INIT_CONSTRUCTOR", "FUNC_CALL", "FUNC_ARRAY_CALL", "FUNC_ARRAY_CALL_AWAIT", "AWAIT", "VFUNC_CALL", "VFUNC_SETUP_CALLBACK", "VFUNC_RETURN", "JUMP_UNCONDITIONAL", "JUMP_EQ", "JUMP_NOT_EQ", "TRY_CATCH_FINALLY", "THROW", "THROW_ARGUMENT", "SET", "SET_REF", "SET_PROP", "GET_PROP", "SET_INDEX", "GET_INDEX", "WRITE_EXT", "DETACH_REF", "SET_NULL", "SET_UNDEFINED", "EQ_COERCE", "EQ", "NOT_EQ_COERCE", "NOT_EQ", "LESS_THAN", "LESS_THAN_EQ", "GREATER_THAN", "GREATER_THAN_EQ", "TEST", "TEST_NEQ", "ADD", "SUBTRACT", "MULTIPLY", "DIVIDE", "MODULO", "POWER", "AND", "BNOT", "OR", "XOR", "SHIFT_LEFT", "SHIFT_RIGHT", "SPREAD", "SPREAD_INTO", "NOT", "NEGATE", "PLUS", "INCREMENT", "DECREMENT", "TYPEOF", "VOID", "DELETE", "LOGICAL_AND", "LOGICAL_OR", "LOGICAL_NULLISH", "GET_ITERATOR", "ITERATOR_NEXT", "ITERATOR_DONE", "ITERATOR_VALUE", "GET_PROPERTIES", "NOP", "END", "PRINT"]

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
        this.regstack.push([this.registers.slice(), returnDataStore, new Map(this.registerRefs)]);
        for (let i = 0; i < argMap.length; i += 2) {
            this.write(argMap[i], this.read(argMap[i + 1]));
        }
        this.registers[registers.INSTRUCTION_POINTER] = cur + offset - 1;
    }, VFUNC_SETUP_CALLBACK: function () {
        const cur = this.read(registers.INSTRUCTION_POINTER);
        const fnOffset = this.readDWORD(), dest = this.readByte(), returnDataStore = this.readByte(),
            isAsync = this.readBool(), hasDynamicThis = this.readBool(), thisRegister = this.readByte(), useRest = this.readBool(), argArrayMapper = this.readArrayRegisters(), argOrder = this.readArrayRegisters(), captureMappings = this.readArrayRegisters();
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
            vm.regstack.push([vm.registers.slice(), returnDataStore, new Map(vm.registerRefs)]);
            bindCaptureReferences(vm);
            const restIndex = argOrder.length - 1;
            if (hasDynamicThis) {
                vm.write(thisRegister, thisArg);
            }
            for (let i = 0; i < argArrayMapper.length; i++) {
                const sourceIndex = argOrder[i];
                if (useRest && sourceIndex === restIndex) {
                    vm.write(argArrayMapper[i], args.slice(sourceIndex));
                    continue;
                }
                vm.write(argArrayMapper[i], args[sourceIndex]);
            }
            vm.registers[registers.INSTRUCTION_POINTER] = cur + fnOffset - 1;
            vm.run()
            const res = vm.read(returnDataStore);
            const [oldRegisters, _, oldRegisterRefs] = vm.regstack.pop();
            vm.registers = oldRegisters;
            vm.registerRefs = oldRegisterRefs;

            return res
        }

        async function runAsync(thisArg, args) {
            const fork = new vm.constructor();
            fork.code = vm.code;
            fork.registers = vm.registers.slice();
            fork.regstack = [];
            fork.registerRefs = new Map(vm.registerRefs);
            fork.adoptMemoryProtectionState(vm.memoryProtectionState);
            bindCaptureReferences(fork);
            const restIndex = argOrder.length - 1;
            if (hasDynamicThis) {
                fork.write(thisRegister, thisArg);
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
        if (oldRegisterRefs) {
            this.registerRefs = oldRegisterRefs;
        }
        this.write(returnDataStore, retValue);
    }, JUMP_UNCONDITIONAL: function () {
        const cur = this.read(registers.INSTRUCTION_POINTER);
        const offset = this.readDWORD();
        this.registers[registers.INSTRUCTION_POINTER] = cur + offset - 1;
    }, JUMP_EQ: function () {
        const cur = this.read(registers.INSTRUCTION_POINTER);
        const register = this.readByte(), offset = this.readDWORD();
        if (this.read(register)) {

            this.registers[registers.INSTRUCTION_POINTER] = cur + offset - 1;
        }
    }, JUMP_NOT_EQ: function () {
        const cur = this.read(registers.INSTRUCTION_POINTER);
        const register = this.readByte(), offset = this.readDWORD();
        if (!this.read(register)) {

            this.registers[registers.INSTRUCTION_POINTER] = cur + offset - 1;
        } else {

        }
    }, TRY_CATCH_FINALLY: function () {
        const cur = this.read(registers.INSTRUCTION_POINTER);
        const errorRegister = this.readByte();
        const catchOffset = this.readDWORD(), finallyOffset = this.readDWORD();
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
    constructor() {
        this.registers = new Array(256).fill(null)
        this.regstack = []
        this.opcodes = {}
        this.code = null
        this.bytecodeIntegrityKey = ""
        this.memoryProtectionState = null
        this.registerRefs = new Map()
        this.executionMode = "sync"
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
        this.memoryProtectionState = createMemoryProtectionState(key);
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
        return byte
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
        return this.readByte() << 24 | this.readByte() << 16 | this.readByte() << 8 | this.readByte()
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
        code = unpackBytecodeEnvelope(code, format, this.bytecodeIntegrityKey)
        if (!format) {

            this.code = code
            return
        }
        const buffer = decodeBytecodeBuffer(code, format)
        if (buffer[0] === 0x78 && buffer[1] === 0x9c) {

            this.code = inflateBytecode(buffer)
        } else {
            this.code = buffer
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
            const opcode = this.readByte()
            if (opcode === undefined || opNames[opcode] === "END") {
                break
            }
            if (!this.opcodes[opcode]) {
                continue
            }
            try {
                this.opcodes[opcode]()
            } catch (e) {

                throw e
            }
        }
    }

    async runAsync() {
        this.executionMode = "async"
        while (true) {
            const opcode = this.readByte()
            if (opcode === undefined || opNames[opcode] === "END") {
                break
            }
            if (!this.opcodes[opcode]) {
                continue
            }

            try {
                await this.opcodes[opcode]()
            } catch (e) {

                throw e
            }
        }
    }
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = JSVM
} else if (typeof globalThis !== "undefined") {
    globalThis.JSVM = JSVM
}
