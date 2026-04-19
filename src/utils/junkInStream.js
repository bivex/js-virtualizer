/**
 * Junk Instructions In-Stream
 *
 * Interleaves dead instructions between real bytecode instructions.
 * Unlike opaque predicates (which use scratch registers + conditional jumps),
 * these are lightweight NOP-equivalent groups that execute harmlessly.
 */

const crypto = require("crypto");
const { Opcode } = require("./assembler");
const { encodeDWORD, encodeString } = require("./assembler");

// Opcodes with embedded jump offsets — same table as opaquePredicates.js
const JUMP_OFFSET_OPCODES = {
    "JUMP_UNCONDITIONAL": { positions: [0] },
    "JUMP_EQ": { positions: [1] },
    "JUMP_NOT_EQ": { positions: [1] },
    "MACRO_TEST_JUMP_EQ": { positions: [3] },
    "MACRO_TEST_JUMP_NOT_EQ": { positions: [3] },
    "TRY_CATCH_FINALLY": { positions: [1, 5] },
    "VFUNC_CALL": { positions: [0] },
    "VFUNC_SETUP_CALLBACK": { positions: [0] },
};

// Skip insertion near these opcodes
const SKIP_OPCODES = new Set([
    "END", "TRY_CATCH_FINALLY", "VFUNC_CALL", "VFUNC_SETUP_CALLBACK",
    "VFUNC_RETURN", "THROW", "THROW_ARGUMENT", "CFF_DISPATCH"
]);

function readDWORD(data, pos, endian) {
    if (endian === "LE") {
        return data[pos] | (data[pos + 1] << 8) | (data[pos + 2] << 16) | (data[pos + 3] << 24);
    }
    return (data[pos] << 24) | (data[pos + 1] << 16) | (data[pos + 2] << 8) | data[pos + 3];
}

function writeDWORD(data, pos, value, endian) {
    if (endian === "LE") {
        data[pos] = value & 0xFF;
        data[pos + 1] = (value >>> 8) & 0xFF;
        data[pos + 2] = (value >>> 16) & 0xFF;
        data[pos + 3] = (value >>> 24) & 0xFF;
    } else {
        data[pos] = (value >>> 24) & 0xFF;
        data[pos + 1] = (value >>> 16) & 0xFF;
        data[pos + 2] = (value >>> 8) & 0xFF;
        data[pos + 3] = value & 0xFF;
    }
}

function createJunkInstructionGroup(deadRegs, endian) {
    const group = [];
    const count = 1 + (crypto.randomInt(0, 3)); // 1-3 junk opcodes
    const types = ["LOAD_DWORD", "LOAD_DWORD", "LOAD_STRING", "NOP", "TEST", "ADD", "LOAD_BYTE"];

    for (let i = 0; i < count; i++) {
        const type = types[crypto.randomInt(0, types.length)];
        const reg = deadRegs[crypto.randomInt(0, deadRegs.length)];

        switch (type) {
            case "LOAD_DWORD":
                group.push(new Opcode("LOAD_DWORD", reg, encodeDWORD(crypto.randomInt(0, 0xFFFFFF), endian)));
                break;
            case "LOAD_STRING":
                group.push(new Opcode("LOAD_STRING", reg, encodeString(`__jk_${crypto.randomBytes(2).toString("hex")}`, endian)));
                break;
            case "LOAD_BYTE":
                group.push(new Opcode("LOAD_BYTE", reg, crypto.randomInt(0, 256)));
                break;
            case "TEST":
                group.push(new Opcode("TEST", deadRegs[0], deadRegs[deadRegs.length - 1]));
                break;
            case "ADD":
                group.push(new Opcode("ADD", reg, deadRegs[0], deadRegs[1 % deadRegs.length]));
                break;
            case "NOP":
                group.push(new Opcode("NOP"));
                break;
        }
    }
    return group;
}

function insertJunkInStream(chunk, registerCount, options = {}) {
    const endian = options.polyEndian ?? "BE";
    const cffStateReg = options.cffStateRegister;
    const opaqueScratch = options.opaqueScratch ?? [];
    const density = options.density ?? (6 + crypto.randomInt(0, 5)); // 6-10
    const maxInsertions = options.maxInsertions ?? 20;

    // Pick 4 dead registers from upper range, avoiding CFF state and opaque scratch
    const reserved = new Set([cffStateReg, ...opaqueScratch].filter(x => x !== undefined));
    const deadRegs = [];
    for (let i = registerCount - 20; i < registerCount - 5 && deadRegs.length < 4; i++) {
        if (i > 0 && !reserved.has(i)) deadRegs.push(i);
    }
    if (deadRegs.length === 0) return; // no room for junk

    const original = chunk.code;
    const expanded = [];
    let sinceLastInsert = 0;
    let insertions = 0;
    let inVfunc = false;

    for (let idx = 0; idx < original.length; idx++) {
        const op = original[idx];
        const name = op.name;

        // Track VFUNC regions
        if (name === "VFUNC_CALL") inVfunc = true;
        if (name === "VFUNC_RETURN") inVfunc = false;

        expanded.push(op);

        // Skip special opcodes and VFUNC regions
        if (SKIP_OPCODES.has(name) || inVfunc) {
            sinceLastInsert++;
            continue;
        }

        sinceLastInsert++;
        if (sinceLastInsert >= density && insertions < maxInsertions) {
            const junk = createJunkInstructionGroup(deadRegs, endian);
            for (const j of junk) expanded.push(j);
            sinceLastInsert = 0;
            insertions++;
        }
    }

    // Recalculate jump offsets (same logic as opaquePredicates.js)
    const newByteOffsets = [];
    let bytePos = 0;
    for (const op of expanded) {
        newByteOffsets.push(bytePos);
        bytePos += op.toBytes().length;
    }

    const origByteOffsets = [];
    let origPos = 0;
    for (const op of original) {
        origByteOffsets.push(origPos);
        origPos += op.toBytes().length;
    }

    // Build mapping: original byte offset -> new byte offset
    const origToNew = new Map();
    let origIdx = 0;
    for (let i = 0; i < expanded.length && origIdx < original.length; i++) {
        if (expanded[i] === original[origIdx]) {
            origToNew.set(origByteOffsets[origIdx], newByteOffsets[i]);
            origIdx++;
        }
    }

    // Patch jump offsets
    let runningBytePos = 0;
    for (const op of expanded) {
        const spec = JUMP_OFFSET_OPCODES[op.name];
        if (spec) {
            const data = op.data;
            const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
            for (const pos of spec.positions) {
                const oldOffset = readDWORD(buf, pos, endian);
                const oldTarget = runningBytePos + oldOffset - 1;
                const newTarget = origToNew.get(oldTarget);
                if (newTarget !== undefined) {
                    const newOffset = newTarget - runningBytePos + 1;
                    writeDWORD(buf, pos, newOffset, endian);
                }
            }
        }
        runningBytePos += op.toBytes().length;
    }

    chunk.code = expanded;
}

module.exports = { insertJunkInStream, createJunkInstructionGroup };
