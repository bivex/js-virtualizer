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

const {registers} = require("./constants");
const {log, LogData} = require("./log");

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
        log(`Loading DWORD ${value} into register ${register}`)
        this.write(register, value);
    },
    LOAD_FLOAT: function () {
        const register = this.readByte(), value = this.readFloat();
        this.write(register, value);
    },
    LOAD_STRING: function () {
        const register = this.readByte(), value = this.readString();
        log(`Loading string ${value} into register ${register}`)
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
        const fn = this.readByte(), dst = this.readByte(),
            funcThis = this.readByte(), args = this.readArray()
        log(`Calling function at register ${fn} with this at register ${funcThis} and args: ${args}`);
        const res = this.read(fn).apply(this.read(funcThis), args);
        log(`Function call result: ${res} => ${dst}`);
        this.write(dst, res);
    },
    FUNC_ARRAY_CALL: function () {
        const fn = this.readByte(), dst = this.readByte(),
            funcThis = this.readByte(), argsReg = this.readByte();
        const args = this.read(argsReg);
        log(`Calling function with arraycall convention at register ${fn} with this at register ${funcThis} and args: ${args}`);
        const res = this.read(fn).apply(this.read(funcThis), args);
        log(`Function call result: ${res} => ${dst}`);
        this.write(dst, res);
    },
    FUNC_ARRAY_CALL_AWAIT: async function () {
        const fn = this.readByte(), dst = this.readByte(),
            funcThis = this.readByte(), argsReg = this.readByte();
        const args = this.read(argsReg);
        log(`Calling function with arraycall convention at register ${fn} with this at register ${funcThis} and args: ${args}`);
        const res = await this.read(fn).apply(this.read(funcThis), args);
        log(`Function call result: ${res} => ${dst}`);
        this.write(dst, res);
    },
    AWAIT: async function () {
        const dest = this.readByte(), src = this.readByte();
        this.write(dest, await this.read(src));
    },
    VFUNC_CALL: function () {
        const cur = this.read(registers.INSTRUCTION_POINTER);
        const offset = this.readDWORD(),
            returnDataStore = this.readByte(),
            argMap = this.readArrayRegisters();
        // store current register state for restoration
        this.regstack.push([this.captureRegisterSnapshot(), returnDataStore, new Map(this.registerRefs)]);
        // convert current register positions (rel) to function necessary registers (abs)
        // (abs, rel, abs, rel, ...)
        for (let i = 0; i < argMap.length; i += 2) {
            this.write(argMap[i], this.read(argMap[i + 1]));
        }
        this.registers[registers.INSTRUCTION_POINTER] = cur + offset - 1;
    },
    VFUNC_SETUP_CALLBACK: function () {
        const cur = this.read(registers.INSTRUCTION_POINTER);
        const fnOffset = this.readDWORD(),
            dest = this.readByte(),
            returnDataStore = this.readByte(),
            isAsync = this.readBool(),
            hasDynamicThis = this.readBool(),
            thisRegister = this.readByte(),
            usesArguments = this.readBool(),
            argumentsRegister = this.readByte(),
            useRest = this.readBool(),
            argArrayMapper = this.readArrayRegisters(),
            argOrder = this.readArrayRegisters(),
            captureMappings = this.readArrayRegisters();
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
            fork.code = vm.code;
            fork.registers = vm.captureRegisterSnapshot();
            fork.regstack = [];
            fork.registerRefs = new Map(vm.registerRefs);
            fork.statefulOpcodesEnabled = vm.statefulOpcodesEnabled;
            fork.jumpTargetEncodingEnabled = vm.jumpTargetEncodingEnabled;
            fork.perInstructionEncodingEnabled = vm.perInstructionEncodingEnabled;
            fork.runtimeOpcodeState = vm.runtimeOpcodeState;
            fork.adoptMemoryProtectionState(vm.memoryProtectionState);
            fork.adoptAntiDebugState(vm.antiDebugState);
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
            fork.run()
            const res = fork.read(returnDataStore);
            log(`Callback result: ${res}`)
            return res
        }

        async function runAsync(thisArg, args) {
            const fork = new vm.constructor(vm.getProfile());
            fork.setBytecodeIntegrityKey(vm.bytecodeIntegrityKey);
            fork.code = vm.code;
            fork.registers = vm.captureRegisterSnapshot();
            fork.regstack = [];
            fork.registerRefs = new Map(vm.registerRefs);
            fork.statefulOpcodesEnabled = vm.statefulOpcodesEnabled;
            fork.jumpTargetEncodingEnabled = vm.jumpTargetEncodingEnabled;
            fork.perInstructionEncodingEnabled = vm.perInstructionEncodingEnabled;
            fork.runtimeOpcodeState = vm.runtimeOpcodeState;
            fork.adoptMemoryProtectionState(vm.memoryProtectionState);
            fork.adoptAntiDebugState(vm.antiDebugState);
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
            await fork.runAsync()
            const res = fork.read(returnDataStore);
            log(`Async callback result: ${res}`)
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
            log(`Jumping to ${cur + offset - 1}`)
            this.registers[registers.INSTRUCTION_POINTER] = cur + offset - 1;
        }
    },
    JUMP_NOT_EQ: function () {
        const cur = this.read(registers.INSTRUCTION_POINTER);
        const register = this.readByte(), offset = this.readJumpTargetDWORD();
        if (!this.read(register)) {
            log(new LogData(`Jumping to ${cur + offset - 1}`, 'accent'))
            this.registers[registers.INSTRUCTION_POINTER] = cur + offset - 1;
        } else {
            log(new LogData(`Not jumping to ${cur + offset - 1}`, 'accent'))
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
        const register = this.readByte();
        this.detachRegisterReference(register);
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
        log(`Moving property ${this.read(prop)} from object to ${dest}`)
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
        log(`Comparing ${this.read(left)} (${left}) === ${this.read(right)} (${right}) => ${dest}`)
        this.write(dest, this.read(left) === this.read(right));
    },
    NOT_EQ_COERCE: function() {
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

module.exports = implOpcode;
