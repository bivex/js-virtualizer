const { Opcode, encodeDWORD, encodeString } = require("./assembler");
const crypto = require("crypto");

function randomInt(min, max) {
    return crypto.randomInt(min, max);
}

// Each generator returns { opcodes, resultReg, expectedResult: bool }
// expectedResult true → TEST(result) is truthy → JUMP_EQ skips junk
// expectedResult false → TEST(result) is falsy → JUMP_NOT_EQ skips junk

function createArithmeticIdentity(rA, rB, rDest) {
    const val = randomInt(1, 0xFFFF);
    return {
        opcodes: [
            new Opcode("LOAD_DWORD", rA, encodeDWORD(val)),
            new Opcode("LOAD_DWORD", rB, encodeDWORD(val)),
            new Opcode("EQ", rDest, rA, rB),
        ],
        resultReg: rDest,
        expectedResult: true,
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
        resultReg: rDest,
        expectedResult: true,
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
        resultReg: rDest,
        expectedResult: false,
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
        resultReg: rDest,
        expectedResult: true,
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
        resultReg: rDest,
        expectedResult: false,
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

function insertOpaquePredicates(chunk, opaqueScratch, registerCount, options = {}) {
    if (!opaqueScratch || opaqueScratch.length < 5) return chunk;

    const density = options.density ?? randomInt(8, 13);
    const maxPredicates = options.maxPredicates ?? 15;

    const [rA, rB, rC, rD, rE] = opaqueScratch;
    const junkRegs = [rD, rE, rA];

    const newCode = [];
    let predicatesInserted = 0;
    let sinceLastInsert = 0;

    for (let i = 0; i < chunk.code.length; i++) {
        const opcode = chunk.code[i];

        // Don't insert before/after certain opcodes
        const isSpecial = opcode.name === "END" ||
            opcode.name === "TRY_CATCH_FINALLY" ||
            opcode.name === "VFUNC_CALL" ||
            opcode.name === "VFUNC_SETUP_CALLBACK" ||
            opcode.name === "VFUNC_RETURN" ||
            opcode.name === "THROW" ||
            opcode.name === "THROW_ARGUMENT";

        if (!isSpecial && sinceLastInsert >= density && predicatesInserted < maxPredicates) {
            const genIdx = randomInt(0, PREDICATE_GENERATORS.length);
            const gen = PREDICATE_GENERATORS[genIdx];
            const predicate = gen(rA, rB, rC, rD); // pass 4 registers; 3-arg gens ignore the fourth

            // TEST resultReg, resultReg
            const testOpcode = new Opcode("TEST", predicate.resultReg, predicate.resultReg);

            // Conditional jump with placeholder offset
            const jumpName = predicate.expectedResult ? "JUMP_EQ" : "JUMP_NOT_EQ";
            const jumpOpcode = new Opcode(jumpName, predicate.resultReg, encodeDWORD(0));

            // Junk sequence
            const junk = createJunkSequence(junkRegs);
            const junkBytes = junk.reduce((sum, op) => sum + op.toBytes().length, 0);

            // Jump over junk: offset = junkBytes + 6
            // JUMP_EQ handler: target = cur + offset - 1
            // cur = IP at start of jump data (after opcode byte read by readOpcode)
            // After reading reg(1) + offset(4) = 5 bytes, IP = cur + 5
            // We want target = cur + 5 + junkBytes = cur + offset - 1
            // So offset = junkBytes + 6
            const jumpOffset = junkBytes + 6;
            jumpOpcode.modifyArgs(predicate.resultReg, encodeDWORD(jumpOffset));

            predicate.opcodes.forEach(op => newCode.push(op));
            newCode.push(testOpcode);
            newCode.push(jumpOpcode);
            junk.forEach(op => newCode.push(op));

            predicatesInserted++;
            sinceLastInsert = 0;
        }

        newCode.push(opcode);
        sinceLastInsert++;
    }

    chunk.code = newCode;
    return chunk;
}

module.exports = { insertOpaquePredicates };
