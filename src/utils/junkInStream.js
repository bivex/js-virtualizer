/**
 * Junk Instructions In-Stream
 *
 * Interleaves dead instructions between real bytecode instructions.
 * Uses _origByteOffset tagging (same pattern as opaquePredicates.js)
 * for reliable jump offset recalculation.
 */

const crypto = require("crypto");
const { Opcode, encodeDWORD, encodeString } = require("./assembler");

const JUMP_OFFSET_OPCODES = {
    "JUMP_UNCONDITIONAL": { positions: [0], formula: "cur + offset - 1" },
    "JUMP_EQ": { positions: [1], formula: "cur + offset - 1" },
    "JUMP_NOT_EQ": { positions: [1], formula: "cur + offset - 1" },
    "MACRO_TEST_JUMP_EQ": { positions: [3], formula: "cur + offset + 2" },
    "MACRO_TEST_JUMP_NOT_EQ": { positions: [3], formula: "cur + offset + 2" },
    "TRY_CATCH_FINALLY": { positions: [1, 5], formula: "cur + offset - 1" },
    "VFUNC_CALL": { positions: [0], formula: "cur + offset - 1" },
    "VFUNC_SETUP_CALLBACK": { positions: [0], formula: "cur + offset - 1" },
};

function computeTargetByte(cur, offset, formula) {
    if (formula === "cur + offset + 2") return cur + offset + 2;
    return cur + offset - 1;
}

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
    const count = 1 + crypto.randomInt(0, 3);
    const types = ["LOAD_DWORD", "LOAD_DWORD", "NOP", "TEST", "LOAD_BYTE"];

    for (let i = 0; i < count; i++) {
        const type = types[crypto.randomInt(0, types.length)];
        const reg = deadRegs[crypto.randomInt(0, deadRegs.length)];

        switch (type) {
            case "LOAD_DWORD":
                group.push(new Opcode("LOAD_DWORD", reg, encodeDWORD(crypto.randomInt(0, 0xFFFFFF), endian)));
                break;
            case "LOAD_BYTE":
                group.push(new Opcode("LOAD_BYTE", reg, crypto.randomInt(0, 256)));
                break;
            case "TEST":
                group.push(new Opcode("TEST", deadRegs[0], deadRegs[deadRegs.length - 1]));
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
    const density = options.density ?? (6 + crypto.randomInt(0, 5));
    const maxInsertions = options.maxInsertions ?? 20;

    const reserved = new Set([cffStateReg, ...opaqueScratch].filter(x => x !== undefined));
    const deadRegs = [];
    for (let i = registerCount - 20; i < registerCount - 5 && deadRegs.length < 4; i++) {
        if (i > 0 && !reserved.has(i)) deadRegs.push(i);
    }
    if (deadRegs.length === 0) return;

    const original = chunk.code;

    // Tag each original opcode with its byte offset
    const origByteOffsets = [];
    let bpos = 0;
    for (let i = 0; i < original.length; i++) {
        original[i]._origByteOffset = bpos;
        origByteOffsets.push(bpos);
        bpos += original[i].toBytes().length;
    }

    const expanded = [];
    let sinceLastInsert = 0;
    let insertions = 0;
    let inVfunc = false;

    for (let idx = 0; idx < original.length; idx++) {
        const op = original[idx];
        const name = op.name;

        if (name === "VFUNC_CALL") inVfunc = true;
        if (name === "VFUNC_RETURN") inVfunc = false;

        expanded.push(op);

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

    // Compute new byte offsets
    const newByteOffsets = [];
    let newPos = 0;
    for (let i = 0; i < expanded.length; i++) {
        newByteOffsets.push(newPos);
        newPos += expanded[i].toBytes().length;
    }

    // Build map: original byte offset -> new byte offset
    const origToNewByte = new Map();
    for (let i = 0; i < expanded.length; i++) {
        const orig = expanded[i]._origByteOffset;
        if (orig !== undefined) {
            origToNewByte.set(orig, newByteOffsets[i]);
        }
    }

    // Fix jump offsets in original opcodes
    for (let i = 0; i < expanded.length; i++) {
        const opcode = expanded[i];
        if (opcode._origByteOffset === undefined) continue;

        const info = JUMP_OFFSET_OPCODES[opcode.name];
        if (!info) { delete opcode._origByteOffset; continue; }

        const newCur = newByteOffsets[i] + 1;
        const data = opcode.data;
        const formula = info.formula;

        for (const pos of info.positions) {
            const oldOffset = readDWORD(data, pos, endian);
            const oldCur = opcode._origByteOffset + 1;
            const oldTargetByte = computeTargetByte(oldCur, oldOffset, formula);

            const newTargetByte = origToNewByte.get(oldTargetByte);
            if (newTargetByte === undefined) continue;

            let newOffset;
            if (formula === "cur + offset + 2") {
                newOffset = newTargetByte - newCur - 2;
            } else {
                newOffset = newTargetByte - newCur + 1;
            }
            writeDWORD(data, pos, newOffset, endian);
        }

        delete opcode._origByteOffset;
    }

    chunk.code = expanded;
}

module.exports = { insertJunkInStream, createJunkInstructionGroup };
