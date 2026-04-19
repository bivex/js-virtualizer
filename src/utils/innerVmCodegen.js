/**
 * Copyright (c) 2026 Bivex
 *
 * Generates the InnerVM runtime class as a JavaScript source string.
 * This string is parsed and injected into the vm_dist AST during transpilation.
 */

function generateInnerVMSource() {
    return `
const INNER_OP_COUNT = 16;
const INNER_REG_COUNT = 16;

class InnerVM {
    constructor(outerVM) {
        this.outerVM = outerVM;
        this.regs = new Array(INNER_REG_COUNT).fill(0);
        this.program = null;
        this.ip = 0;
        this.innerOpcodes = null;
        this.handlers = [
            /* I_LOAD_BYTE */ function() {
                var r = this.program[this.ip++];
                this.regs[r] = this.program[this.ip++];
            },
            /* I_LOAD_DWORD */ function() {
                var r = this.program[this.ip++];
                var b1 = this.program[this.ip++];
                var b2 = this.program[this.ip++];
                var b3 = this.program[this.ip++];
                var b4 = this.program[this.ip++];
                this.regs[r] = (b1 << 24 | b2 << 16 | b3 << 8 | b4) | 0;
            },
            /* I_READ_OUTER */ function() {
                var ir = this.program[this.ip++];
                var or = this.program[this.ip++];
                this.regs[ir] = this.outerVM.read(or);
            },
            /* I_WRITE_OUTER */ function() {
                var or = this.program[this.ip++];
                var ir = this.program[this.ip++];
                this.outerVM.write(or, this.regs[ir]);
            },
            /* I_ADD */ function() {
                var d = this.program[this.ip++];
                var l = this.program[this.ip++];
                var r = this.program[this.ip++];
                this.regs[d] = this.regs[l] + this.regs[r];
            },
            /* I_SUBTRACT */ function() {
                var d = this.program[this.ip++];
                var l = this.program[this.ip++];
                var r = this.program[this.ip++];
                this.regs[d] = (this.regs[l] - this.regs[r]) | 0;
            },
            /* I_XOR */ function() {
                var d = this.program[this.ip++];
                var l = this.program[this.ip++];
                var r = this.program[this.ip++];
                this.regs[d] = (this.regs[l] ^ this.regs[r]) >>> 0;
            },
            /* I_AND */ function() {
                var d = this.program[this.ip++];
                var l = this.program[this.ip++];
                var r = this.program[this.ip++];
                this.regs[d] = (this.regs[l] & this.regs[r]) >>> 0;
            },
            /* I_SHL */ function() {
                var d = this.program[this.ip++];
                var l = this.program[this.ip++];
                var r = this.program[this.ip++];
                this.regs[d] = (this.regs[l] << this.regs[r]) | 0;
            },
            /* I_EQ */ function() {
                var d = this.program[this.ip++];
                var l = this.program[this.ip++];
                var r = this.program[this.ip++];
                this.regs[d] = (this.regs[l] === this.regs[r]) ? 1 : 0;
            },
            /* I_JZ */ function() {
                var tr = this.program[this.ip++];
                var hi = this.program[this.ip++];
                var lo = this.program[this.ip++];
                var offset = (hi << 8 | lo) | 0;
                if (offset > 32767) offset = offset - 65536;
                if (this.regs[tr] === 0) {
                    this.ip = this.ip + offset;
                }
            },
            /* I_CALL */ function() {
                var dr = this.program[this.ip++];
                var fnr = this.program[this.ip++];
                var thr = this.program[this.ip++];
                var argc = this.program[this.ip++];
                var args = [];
                for (var i = 0; i < argc; i++) {
                    args.push(this.regs[this.program[this.ip++]]);
                }
                var fn = this.regs[fnr];
                var thisVal = this.regs[thr];
                this.regs[dr] = fn.apply(thisVal, args);
            },
            /* I_READ_PROP */ function() {
                var dr = this.program[this.ip++];
                var objr = this.program[this.ip++];
                var propr = this.program[this.ip++];
                this.regs[dr] = this.regs[objr][this.regs[propr]];
            },
            /* I_ARR_READ */ function() {
                var dr = this.program[this.ip++];
                var arrr = this.program[this.ip++];
                var idxr = this.program[this.ip++];
                this.regs[dr] = this.regs[arrr][this.regs[idxr]];
            },
            /* I_NOP */ function() {},
            /* I_END */ function() {
                this._running = false;
            }
        ];
    }

    loadProgram(bytecode) {
        this.program = bytecode;
        this.ip = 0;
        this._running = true;
        this.regs.fill(0);
    }

    patchByte(position, value) {
        if (this.program) this.program[position] = value & 0xFF;
    }

    patchDWORD(position, value) {
        if (!this.program) return;
        this.program[position] = (value >>> 24) & 0xFF;
        this.program[position + 1] = (value >>> 16) & 0xFF;
        this.program[position + 2] = (value >>> 8) & 0xFF;
        this.program[position + 3] = value & 0xFF;
    }

    run() {
        while (this.ip < this.program.length) {
            var opcode = this.program[this.ip++];
            if (globalThis.__JSVM_DEBUG__) {
                var names = ["LOAD_BYTE", "LOAD_DWORD", "READ_OUTER", "WRITE_OUTER", "ADD", "SUBTRACT", "XOR", "AND", "SHL", "EQ", "JZ", "CALL", "READ_PROP", "ARR_READ", "NOP", "END"];
                console.log("[NESTED] IP=" + (this.ip-1) + " Op=" + names[opcode] + " Regs=" + JSON.stringify(this.regs.slice(0, 8)));
            }
            if (opcode === 15 /* I_END */) break;
            var handler = this.handlers[opcode];
            if (!handler) break;
            handler.call(this);
        }
    }
}
`;
}

module.exports = { generateInnerVMSource };
