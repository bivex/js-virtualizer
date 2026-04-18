const { Opcode, encodeDWORD, encodeString } = require("./assembler");
const crypto = require("crypto");

function randomInt(min, max) {
    return crypto.randomInt(min, max);
}

function createArithmeticIdentity(rA, rB, rDest) {
    const val = randomInt(1, 0xFFFF);
    return {
        opcodes: [
            new Opcode("LOAD_DWORD", rA, encodeDWORD(val)),
            new Opcode("LOAD_DWORD", rB, encodeDWORD(val)),
            new Opcode("EQ", rDest, rA, rB),
        ],
    };
}

function createBitwiseComplement(rA, rB, rDest) {
    const val = randomInt(1, 0xFFFF);
    return {
        opcodes: [
            new Opcode("LOAD_DWORD", rA, encodeDWORD(val)),
            new Opcode("BNOT", rB, rA),
            new Opcode("OR", rDest, rA, rB),
        ],
    };
}

function createXorSelf(rA, rB, rDest) {
    const val = randomInt(1, 0xFFFF);
    return {
        opcodes: [
            new Opcode("LOAD_DWORD", rA, encodeDWORD(val)),
            new Opcode("LOAD_DWORD", rB, encodeDWORD(val)),
            new Opcode("XOR", rDest, rA, rB),
        ],
    };
}

function createAlgebraicPositive(rA, rB, rC, rDest) {
    const a = randomInt(1, 50);
    const b = randomInt(1, 50);
    return {
        opcodes: [
            new Opcode("LOAD_DWORD", rA, encodeDWORD(a)),
            new Opcode("LOAD_DWORD", rB, encodeDWORD(b)),
            new Opcode("MULTIPLY", rC, rA, rB),
            new Opcode("LOAD_DWORD", rA, encodeDWORD(0)),
            new Opcode("GREATER_THAN", rDest, rC, rA),
        ],
    };
}

function createDoubleNegation(rA, rB, rDest) {
    const val = randomInt(1, 0xFFFF);
    return {
        opcodes: [
            new Opcode("LOAD_DWORD", rA, encodeDWORD(val)),
            new Opcode("NOT", rB, rA),
            new Opcode("NOT", rDest, rB),
        ],
    };
}

const PREDICATE_GENERATORS = [
    createArithmeticIdentity,
    createBitwiseComplement,
    createXorSelf,
    createAlgebraicPositive,
    createDoubleNegation,
];

function createJunkSequence(registers) {
    const [rA, rB, rC] = registers;
    const val1 = randomInt(100, 0xFFFF);
    const val2 = randomInt(100, 0xFFFF);
    const label = `__opq_${crypto.randomBytes(3).toString("hex")}`;
    return [
        new Opcode("LOAD_DWORD", rA, encodeDWORD(val1)),
        new Opcode("LOAD_DWORD", rB, encodeDWORD(val2)),
        new Opcode("ADD", rC, rA, rB),
        new Opcode("LOAD_STRING", rA, encodeString(label)),
        new Opcode("NOP"),
    ];
}

// Opcodes with embedded jump offsets and their data positions
// Also specify how the target is computed from cur + offset
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
    return cur + offset - 1; // default: cur + offset - 1
}

function readDWORD(data, pos) {
    return (data[pos] << 24) | (data[pos + 1] << 16) | (data[pos + 2] << 8) | data[pos + 3];
}

function writeDWORD(data, pos, value) {
    data[pos] = (value >> 24) & 0xFF;
    data[pos + 1] = (value >> 16) & 0xFF;
    data[pos + 2] = (value >> 8) & 0xFF;
    data[pos + 3] = value & 0xFF;
}

function insertOpaquePredicates(chunk, opaqueScratch, registerCount, options = {}) {
    if (!opaqueScratch || opaqueScratch.length < 5) return chunk;

    const density = options.density ?? randomInt(8, 13);
    const maxPredicates = options.maxPredicates ?? 15;

    const code = chunk.code;
    const [rA, rB, rC, rD, rE] = opaqueScratch;
    const junkRegs = [rD, rE, rA];

    // Build set of opcode indices inside VFUNC bodies
    const vfuncRegion = new Set();
    for (let i = 0; i < code.length; i++) {
        if (code[i].name === "VFUNC_SETUP_CALLBACK") {
            let j = i - 1;
            while (j >= 0 && code[j].name === "END") j--;
            while (j >= 0) {
                if (code[j].name === "JUMP_UNCONDITIONAL") {
                    for (let k = j; k <= i; k++) {
                        vfuncRegion.add(k);
                    }
                    break;
                }
                j--;
            }
        }
    }

    // Compute original byte offsets
    const origByteOffsets = [];
    let bpos = 0;
    for (let i = 0; i < code.length; i++) {
        origByteOffsets.push(bpos);
        bpos += code[i].toBytes().length;
    }

    // Build map: original byte offset → opcode index (for target resolution)
    const origByteToIdx = new Map();
    for (let i = 0; i < code.length; i++) {
        origByteToIdx.set(origByteOffsets[i], i);
    }

    const newCode = [];
    let predicatesInserted = 0;
    let sinceLastInsert = 0;

    for (let i = 0; i < code.length; i++) {
        const opcode = code[i];

        const isSpecial = opcode.name === "END" ||
            opcode.name === "TRY_CATCH_FINALLY" ||
            opcode.name === "VFUNC_CALL" ||
            opcode.name === "VFUNC_SETUP_CALLBACK" ||
            opcode.name === "VFUNC_RETURN" ||
            opcode.name === "THROW" ||
            opcode.name === "THROW_ARGUMENT";

        const inVfunc = vfuncRegion.has(i);

        if (!isSpecial && !inVfunc && sinceLastInsert >= density && predicatesInserted < maxPredicates) {
            const genIdx = randomInt(0, PREDICATE_GENERATORS.length);
            const gen = PREDICATE_GENERATORS[genIdx];
            const predicate = gen(rA, rB, rC, rD);

            // Junk sequence
            const junk = createJunkSequence(junkRegs);
            const junkBytes = junk.reduce((sum, op) => sum + op.toBytes().length, 0);

            // JUMP_UNCONDITIONAL over junk
            // cur = IP after opcode byte; reads 4 bytes for offset
            // target = cur + offset - 1; IP after read = cur + 4
            // Want: target = cur + 4 + junkBytes → offset = junkBytes + 5
            const jumpOffset = junkBytes + 5;

            predicate.opcodes.forEach(op => newCode.push(op));
            newCode.push(new Opcode("JUMP_UNCONDITIONAL", encodeDWORD(jumpOffset)));
            junk.forEach(op => newCode.push(op));

            predicatesInserted++;
            sinceLastInsert = 0;
        }

        // Tag original opcodes with their original byte offset for later fixup
        opcode._origByteOffset = origByteOffsets[i];
        newCode.push(opcode);
        sinceLastInsert++;
    }

    chunk.code = newCode;

    // Now recalculate jump offsets for original opcodes
    // Compute new byte offsets
    const newByteOffsets = [];
    let newPos = 0;
    for (let i = 0; i < newCode.length; i++) {
        newByteOffsets.push(newPos);
        newPos += newCode[i].toBytes().length;
    }

    // Build map: original byte offset → new byte offset
    const origToNewByte = new Map();
    for (let i = 0; i < newCode.length; i++) {
        const orig = newCode[i]._origByteOffset;
        if (orig !== undefined) {
            origToNewByte.set(orig, newByteOffsets[i]);
        }
    }

    // Fix up jump offsets in original opcodes
    let fixupCount = 0;
    let fixupMiss = 0;
    for (let i = 0; i < newCode.length; i++) {
        const opcode = newCode[i];
        if (opcode._origByteOffset === undefined) continue; // inserted predicate, skip

        const info = JUMP_OFFSET_OPCODES[opcode.name];
        if (!info) { delete opcode._origByteOffset; continue; }

        const newCur = newByteOffsets[i] + 1;
        const data = opcode.data;
        const formula = info.formula;

        for (const pos of info.positions) {
            const oldOffset = readDWORD(data, pos);
            const oldCur = opcode._origByteOffset + 1;
            const oldTargetByte = computeTargetByte(oldCur, oldOffset, formula);

            const newTargetByte = origToNewByte.get(oldTargetByte);
            if (newTargetByte === undefined) {
                fixupMiss++;
                continue;
            }

            let newOffset;
            if (formula === "cur + offset + 2") {
                newOffset = newTargetByte - newCur - 2;
            } else {
                newOffset = newTargetByte - newCur + 1;
            }
            writeDWORD(data, pos, newOffset);
            fixupCount++;
        }

        delete opcode._origByteOffset;
    }
    if (fixupMiss > 0) {
        console.log(`[opaque] offset fixup: ${fixupCount} fixed, ${fixupMiss} missed`);
    }

    return chunk;
}

module.exports = { insertOpaquePredicates };
