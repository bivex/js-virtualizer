/**
 * Copyright (c) 2026 Bivex
 *
 * Generates the InnerVM runtime class as a JavaScript source string.
 * This string is parsed and injected into the vm_dist AST during transpilation.
 */

function generateInnerVMSource(shuffledOpNames) {
    // Map from opcode name to handler code string
    const handlerTemplates = {
        "I_LOAD_BYTE": "function() { 'I_LOAD_BYTE'; var r = this.program[this.ip++]; this.regs[r] = this.program[this.ip++]; }",
        "I_LOAD_DWORD": "function() { 'I_LOAD_DWORD'; var r = this.program[this.ip++]; var b1 = this.program[this.ip++]; var b2 = this.program[this.ip++]; var b3 = this.program[this.ip++]; var b4 = this.program[this.ip++]; this.regs[r] = (b1 << 24 | b2 << 16 | b3 << 8 | b4) | 0; }",
        "I_READ_OUTER": "function() { 'I_READ_OUTER'; var ir = this.program[this.ip++]; var or = this.program[this.ip++]; this.regs[ir] = this.outerVM.read(or); }",
        "I_WRITE_OUTER": "function() { 'I_WRITE_OUTER'; var or = this.program[this.ip++]; var ir = this.program[this.ip++]; if (or === 0) { this.outerVM.registers[0] = this.regs[ir]; } else { this.outerVM.write(or, this.regs[ir]); } }",
        "I_ADD": "function() { 'I_ADD'; var d = this.program[this.ip++]; var l = this.program[this.ip++]; var r = this.program[this.ip++]; this.regs[d] = this.regs[l] + this.regs[r]; }",
        "I_SUBTRACT": "function() { 'I_SUBTRACT'; var d = this.program[this.ip++]; var l = this.program[this.ip++]; var r = this.program[this.ip++]; this.regs[d] = (this.regs[l] - this.regs[r]) | 0; }",
        "I_XOR": "function() { 'I_XOR'; var d = this.program[this.ip++]; var l = this.program[this.ip++]; var r = this.program[this.ip++]; this.regs[d] = (this.regs[l] ^ this.regs[r]) >>> 0; }",
        "I_AND": "function() { 'I_AND'; var d = this.program[this.ip++]; var l = this.program[this.ip++]; var r = this.program[this.ip++]; this.regs[d] = (this.regs[l] & this.regs[r]) >>> 0; }",
        "I_SHL": "function() { 'I_SHL'; var d = this.program[this.ip++]; var l = this.program[this.ip++]; var r = this.program[this.ip++]; this.regs[d] = (this.regs[l] << this.regs[r]) | 0; }",
        "I_EQ": "function() { 'I_EQ'; var d = this.program[this.ip++]; var l = this.program[this.ip++]; var r = this.program[this.ip++]; this.regs[d] = (this.regs[l] === this.regs[r]) ? 1 : 0; }",
        "I_JZ": "function() { 'I_JZ'; var tr = this.program[this.ip++]; var hi = this.program[this.ip++]; var lo = this.program[this.ip++]; var offset = (hi << 8 | lo) | 0; if (offset > 32767) offset = offset - 65536; if (this.regs[tr] === 0) { this.ip = this.ip + offset; } }",
        "I_CALL": "function() { 'I_CALL'; var dr = this.program[this.ip++]; var fnr = this.program[this.ip++]; var thr = this.program[this.ip++]; var argc = this.program[this.ip++]; var args = []; for (var i = 0; i < argc; i++) { args.push(this.regs[this.program[this.ip++]]); } var fn = this.regs[fnr]; var thisVal = this.regs[thr]; this.regs[dr] = fn.apply(thisVal, args); }",
        "I_READ_PROP": "function() { 'I_READ_PROP'; var dr = this.program[this.ip++]; var objr = this.program[this.ip++]; var propr = this.program[this.ip++]; this.regs[dr] = this.regs[objr][this.regs[propr]]; }",
        "I_ARR_READ": "function() { 'I_ARR_READ'; var dr = this.program[this.ip++]; var arrr = this.program[this.ip++]; var idxr = this.program[this.ip++]; this.regs[dr] = this.regs[arrr][this.regs[idxr]]; }",
        "I_NOP": "function() { 'I_NOP'; }",
        "I_END": "function() { 'I_END'; this._running = false; }"
    };

    // Build handlers array code as JS source lines
    const handlersLines = shuffledOpNames.map(name => {
        const body = handlerTemplates[name] || "function() {}";
        return body;
    });

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
${handlersLines.join(",\n")}
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
        while (this._running) {
            var opcode = this.program[this.ip++];
            var handler = this.handlers[opcode];
            if (!handler) break;
            handler.call(this);
        }
    }
}
`;
}

module.exports = { generateInnerVMSource };
