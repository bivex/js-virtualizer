/**
 * Copyright (c) 2026 Bivex
 *
 * Inner VM opcode definitions for nested virtualization.
 * 16 opcodes — minimal set for virtualizing outer handler logic.
 */

const innerOpNames = [
    "I_LOAD_BYTE",       // [inner_reg, byte]
    "I_LOAD_DWORD",      // [inner_reg, dword(4 bytes)]
    "I_READ_OUTER",      // [inner_reg, outer_reg]
    "I_WRITE_OUTER",     // [outer_reg, inner_reg]
    "I_ADD",             // [dest, left, right]
    "I_SUBTRACT",        // [dest, left, right]
    "I_XOR",             // [dest, left, right]
    "I_AND",             // [dest, left, right]
    "I_SHL",             // [dest, left, right]
    "I_EQ",              // [dest, left, right]
    "I_JZ",              // [test_reg, offset(2 bytes)]
    "I_CALL",            // [dest, fn, this, args_array]
    "I_READ_PROP",       // [dest, obj, prop]
    "I_ARR_READ",        // [dest, arr, idx]
    "I_NOP",
    "I_END"
];

const innerOpcodes = {};
for (let i = 0; i < innerOpNames.length; i++) {
    innerOpcodes[innerOpNames[i]] = i;
}

// Operand format per inner opcode: number of following bytes after the opcode byte
// -1 = variable (handled specially in the runtime)
const innerOperandSizes = [
    2,    // I_LOAD_BYTE: reg + byte
    5,    // I_LOAD_DWORD: reg + 4 bytes
    2,    // I_READ_OUTER: inner_reg + outer_reg
    2,    // I_WRITE_OUTER: outer_reg + inner_reg
    3,    // I_ADD: dest + left + right
    3,    // I_SUBTRACT: dest + left + right
    3,    // I_XOR: dest + left + right
    3,    // I_AND: dest + left + right
    3,    // I_SHL: dest + left + right
    3,    // I_EQ: dest + left + right
    3,    // I_JZ: test_reg + 2 byte offset
    -1,   // I_CALL: variable (dest + fn + this + args_len + args...)
    3,    // I_READ_PROP: dest + obj + prop
    3,    // I_ARR_READ: dest + arr + idx
    0,    // I_NOP
    0     // I_END
];

const INNER_REGISTER_COUNT = 16;

const NESTED_VM_HANDLERS = ["ADD", "FUNC_CALL", "CFF_DISPATCH"];

module.exports = {
    innerOpNames,
    innerOpcodes,
    innerOperandSizes,
    INNER_REGISTER_COUNT,
    NESTED_VM_HANDLERS
};
