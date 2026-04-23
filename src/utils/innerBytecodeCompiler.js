/**
 * Copyright (c) 2026 Bivex
 *
 * Compiles outer VM handler logic into inner VM bytecode.
 * Each compile function returns a Buffer of inner bytecode bytes.
 * Placeholder positions (for runtime patching) are returned alongside.
 */

const {innerOpcodes: op} = require("./innerOpcodes");

/**
 * ADD: dest = read(left) + read(right)
 * Trampoline pre-reads: dest_reg, left_reg, right_reg
 * Inner bytecode reads outer values and computes.
 *
 * Patch table: [{position, operand}] where operand is index into trampoline's pre-read array.
 */
function compileAddInnerBytecode() {
    // Layout:
    //   [0] I_READ_OUTER  [1] r3  [2] {left_reg}
    //   [3] I_READ_OUTER  [4] r4  [5] {right_reg}
    //   [6] I_ADD         [7] r5  [8] r3  [9] r4
    //   [10] I_WRITE_OUTER [11] {dest_reg}  [12] r5
    //   [13] I_END
    const patchTable = [
        {position: 2, operand: 1},   // left_reg (pre-read index 1)
        {position: 5, operand: 2},   // right_reg (pre-read index 2)
        {position: 11, operand: 0}   // dest_reg (pre-read index 0)
    ];

    const bytecode = Buffer.from([
        op.I_READ_OUTER,  3, 0x00,
        op.I_READ_OUTER,  4, 0x00,
        op.I_ADD,         5, 3, 4,
        op.I_WRITE_OUTER, 0x00, 5,
        op.I_END
    ]);

    return {bytecode, patchTable};
}

/**
 * FUNC_CALL: fn.apply(funcThis, args)
 * Trampoline pre-reads: fn_reg, dst_reg, funcThis_reg, args_array
 * Inner bytecode reads outer regs, builds args, calls, writes result.
 */
function compileFuncCallInnerBytecode() {
    // Simplified layout — inner VM only reads fn and funcThis from outer registers.
    // The trampoline handles the actual fn.apply(funcThis, args) and result writing.
    //
    //   [0] I_READ_OUTER  [1] r0  [2] {fn_reg}
    //   [3] I_READ_OUTER  [4] r1  [5] {funcThis_reg}
    //   [6] I_END
    //
    // After inner VM runs:
    //   inner r0 = fn value, inner r1 = funcThis value
    //   Trampoline calls fn.apply(funcThis, args) and writes result to outer dst.

    const patchTable = [
        {position: 2, operand: 0},   // fn_reg (outer register index for fn)
        {position: 5, operand: 1}    // funcThis_reg (outer register index for funcThis)
    ];

    const bytecode = Buffer.from([
        op.I_READ_OUTER,  0, 0x00,   // r0 = outer[fn_reg]
        op.I_READ_OUTER,  1, 0x00,   // r1 = outer[funcThis_reg]
        op.I_END
    ]);

    return {bytecode, patchTable};
}

/**
 * CFF_DISPATCH: scan entry pairs, match state, jump
 * Trampoline pre-reads: cur (IP snapshot), stateReg value, numEntries,
 *   then all entryState + entryOffset pairs
 *
 * Inner bytecode implements the scan loop.
 */
function compileCffDispatchInnerBytecode() {
    // Layout:
    //   I_LOAD_DWORD r0, {currentState}    ; current state value (patched)
    //   I_LOAD_DWORD r1, {numEntries}       ; entry count (patched)
    //   I_LOAD_BYTE r2, 0                   ; loop counter = 0
    //   ; loop start (ip = loopStart)
    //   I_EQ r3, r2, r1                     ; counter == numEntries?
    //   I_JZ r3, +1                         ; if not equal, continue
    //   I_END                                ; no match found, exit
    //   I_LOAD_DWORD r4, {entryState[i]}    ; entry state (patched per iteration)
    //   I_EQ r5, r0, r4                     ; currentState == entryState?
    //   I_JZ r5, +3                         ; if not equal, skip to increment
    //   I_LOAD_DWORD r6, {cur + offset - 1} ; target IP (patched)
    //   I_WRITE_OUTER IP_REG, r6            ; set outer IP
    //   I_END                                ; match found, exit
    //   I_ADD r2, r2, 7                     ; counter += 7 (skip entryState + offset patch slots)
    //   ... but this is too complex for a fixed bytecode.
    //
    // Simpler approach: the trampoline pre-reads ALL entry pairs and builds
    // a flat inner bytecode that checks each entry sequentially.

    // For CFF_DISPATCH, the number of entries varies. The trampoline will
    // build the inner bytecode dynamically based on the actual entries.
    // We return a builder function instead of a static bytecode.

    return {
        dynamic: true,
        build: function(entryPairs, curIP, ipRegIndex) {
            // entryPairs: [{entryState, entryOffset}]
            // Returns {bytecode, patchTable}
            const bytes = [];
            const patchTable = [];

            // I_LOAD_DWORD r0, {currentState}
            bytes.push(op.I_LOAD_DWORD, 0, 0x00, 0x00, 0x00, 0x00);
            patchTable.push({position: 2, operand: 0}); // currentState value (pre-read by trampoline)

            for (let i = 0; i < entryPairs.length; i++) {
                // I_LOAD_DWORD r1, {entryState}
                bytes.push(op.I_LOAD_DWORD, 1, 0x00, 0x00, 0x00, 0x00);
                patchTable.push({position: bytes.length - 4, operand: 1 + i * 2}); // entryState

                // I_EQ r2, r0, r1
                bytes.push(op.I_EQ, 2, 0, 1);

                // I_JZ r2, skip ahead to next check (skip over the match handling code)
                // Match handling: I_LOAD_DWORD (6) + I_WRITE_OUTER (3) + I_END (1) = 10 bytes
                const jzPos = bytes.length;
                bytes.push(op.I_JZ, 2, 0x00, 0x00); // offset placeholder
                const skipBytes = 6 + 3 + 1; // total bytes to skip
                const offsetHi = (skipBytes >>> 8) & 0xFF;
                const offsetLo = skipBytes & 0xFF;
                bytes[bytes.length - 2] = offsetHi;
                bytes[bytes.length - 1] = offsetLo;

                // Match: compute target IP and write it
                // I_LOAD_DWORD r3, {cur + entryOffset - 1}
                bytes.push(op.I_LOAD_DWORD, 3, 0x00, 0x00, 0x00, 0x00);
                patchTable.push({position: bytes.length - 4, operand: 1 + i * 2 + 1}); // targetIP value

                // I_WRITE_OUTER {IP_REG}, r3
                bytes.push(op.I_WRITE_OUTER, ipRegIndex & 0xFF, 3);
                // ipRegIndex is known at compile time (registers.INSTRUCTION_POINTER = 0)

                // I_END
                bytes.push(op.I_END);
            }

            // Final I_END (no match found)
            bytes.push(op.I_END);

            return {bytecode: Buffer.from(bytes), patchTable};
        }
    };
}

/**
 * Encrypt inner bytecode with nested key.
 * XOR: byte ^ ((key ^ (position * 17)) & 0xFF)
 */
function encryptInnerBytecode(bytecode, nestedKey) {
    const encrypted = Buffer.alloc(bytecode.length);
    for (let i = 0; i < bytecode.length; i++) {
        encrypted[i] = bytecode[i] ^ ((nestedKey ^ ((i * 17) | 0)) & 0xFF);
    }
    return encrypted;
}

/**
 * Shuffle inner opcode IDs with a separate seed.
 * Returns a mapping: originalIndex -> newIndex, and shuffled opNames array.
 */
function shuffleInnerOpcodes(seed) {
    const {innerOpNames} = require("./innerOpcodes");
    const {createSeededPermutation} = require("./vmCommon");

    const permutation = createSeededPermutation(innerOpNames.length, seed);
    const shuffledNames = new Array(innerOpNames.length);
    const remap = new Array(innerOpNames.length);

    for (let i = 0; i < innerOpNames.length; i++) {
        shuffledNames[permutation[i]] = innerOpNames[i];
        remap[i] = permutation[i];
    }

    return {shuffledNames, remap};
}

/**
 * Remap inner bytecode bytes according to shuffle.
 */
function remapInnerBytecode(bytecode, remap) {
    const remapped = Buffer.alloc(bytecode.length);
    for (let i = 0; i < bytecode.length; i++) {
        remapped[i] = bytecode[i];
    }
    // Only remap opcode bytes (every instruction's first byte)
    // We need to walk the bytecode sequentially to find opcode positions
    let pos = 0;
    const {innerOperandSizes} = require("./innerOpcodes");
    while (pos < remapped.length) {
        const originalOpcode = remapped[pos];
        if (originalOpcode < remap.length) {
            remapped[pos] = remap[originalOpcode];
        }
        // Skip operands
        pos++; // skip opcode byte
        if (originalOpcode < innerOperandSizes.length) {
            const opSize = innerOperandSizes[originalOpcode];
            if (opSize === -1) {
                // I_CALL: variable format — dest, fn, this, argc, then argc values
                pos += 4; // skip dest, fn, this, argc
                const argc = remapped[pos - 1];
                pos += argc; // skip argc value bytes
            } else {
                pos += opSize;
            }
        } else {
            break; // unknown opcode, stop
        }
    }
    return remapped;
}

module.exports = {
    compileAddInnerBytecode,
    compileFuncCallInnerBytecode,
    compileCffDispatchInnerBytecode,
    encryptInnerBytecode,
    shuffleInnerOpcodes,
    remapInnerBytecode
};
