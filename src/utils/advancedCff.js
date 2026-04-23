/**
 * Advanced Control Flow Flattening
 *
 * Extends the base CFF with:
 * - Indirect jump tables (CFF_JUMP_TABLE) for switch-like dispatch
 * - Computed goto patterns (CFF_COMPUTED_GOTO) with scrambled keys
 * - Multi-level nested dispatch for high-resistance flattening
 */

const crypto = require("crypto");
const { Opcode, VMChunk, encodeDWORD } = require("./assembler");

function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = crypto.randomInt(0, i + 1);
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

/**
 * Build a CFF_JUMP_TABLE opcode from case mappings.
 * @param {number} indexReg - Register holding the switch index
 * @param {Array<{caseValue: number, stateId: number}>} cases - Case entries
 * @param {number} defaultStateId - Default case state ID
 * @param {string} polyEndian
 */
function buildJumpTableOpcode(indexReg, cases, defaultStateId, polyEndian = "BE") {
    const numEntries = cases.length;
    const dataSize = 1 + 4 + numEntries * 8 + 4;
    const data = Buffer.alloc(dataSize);

    data[0] = indexReg;

    const writeU32 = polyEndian === "LE"
        ? (v, o) => data.writeUInt32LE(v >>> 0, o)
        : (v, o) => data.writeUInt32BE(v >>> 0, o);

    writeU32(numEntries, 1);

    for (let i = 0; i < numEntries; i++) {
        const base = 5 + i * 8;
        writeU32(cases[i].caseValue, base);
        writeU32(cases[i].stateId, base + 4);
    }

    writeU32(defaultStateId, 5 + numEntries * 8);

    return new Opcode("CFF_JUMP_TABLE", data);
}

/**
 * Build a CFF_COMPUTED_GOTO opcode with scrambled keys.
 * @param {number} indexReg - Register with computed index
 * @param {number} shiftReg - Register for intermediate shift value
 * @param {Array<{key: number, stateId: number}>} entries - Goto entries
 * @param {number} defaultStateId
 * @param {string} polyEndian
 */
function buildComputedGotoOpcode(indexReg, shiftReg, entries, defaultStateId, polyEndian = "BE") {
    const numEntries = entries.length;
    const dataSize = 1 + 1 + 4 + numEntries * 8 + 4;
    const data = Buffer.alloc(dataSize);

    data[0] = indexReg;
    data[1] = shiftReg;

    const writeU32 = polyEndian === "LE"
        ? (v, o) => data.writeUInt32LE(v >>> 0, o)
        : (v, o) => data.writeUInt32BE(v >>> 0, o);

    writeU32(numEntries, 2);

    for (let i = 0; i < numEntries; i++) {
        const base = 6 + i * 8;
        writeU32(entries[i].key, base);
        writeU32(entries[i].stateId, base + 4);
    }

    writeU32(defaultStateId, 6 + numEntries * 8);

    return new Opcode("CFF_COMPUTED_GOTO", data);
}

/**
 * Scramble a case value using an affine transform.
 * transform(index) = (index * multiplier + offset) mod 2^32
 */
function scrambleCaseValue(index, multiplier, offset) {
    return ((index * multiplier + offset) >>> 0) % 0x100000000;
}

/**
 * Generate a random affine transform pair for case scrambling.
 */
function generateAffineTransform() {
    const multiplier = crypto.randomInt(1, 0xFFFF);
    const offset = crypto.randomInt(1, 0xFFFF);
    return { multiplier, offset };
}

/**
 * Apply advanced CFF with jump tables to a chunk.
 * Converts switch-like patterns into CFF_JUMP_TABLE dispatch.
 *
 * @param {VMChunk} chunk
 * @param {number} indexReg - Register to use for switch index
 * @param {number} stateReg - Register for CFF state
 * @param {object} options
 */
function applyJumpTableCFF(chunk, indexReg, stateReg, options = {}) {
    const polyEndian = options.polyEndian || "BE";
    const opcodes = chunk.code;

    if (opcodes.length < 6) return { initialStateId: 0 };

    // Scan for switch-like patterns: contiguous JUMP_EQ chains comparing same register
    const switchPatterns = detectSwitchPatterns(opcodes, polyEndian);

    if (switchPatterns.length === 0) return { initialStateId: 0 };

    // For each switch pattern, replace with jump table
    for (const pattern of switchPatterns) {
        replaceSwitchWithJumpTable(chunk, pattern, indexReg, stateReg, polyEndian);
    }

    return { modified: true };
}

/**
 * Detect switch-like patterns in opcode stream.
 * Looks for: series of TEST + JUMP_EQ/NOT_EQ with the same condition register
 * that would form a switch statement.
 */
function detectSwitchPatterns(opcodes, polyEndian) {
    const patterns = [];
    let i = 0;

    while (i < opcodes.length) {
        const op = opcodes[i];

        // Look for MACRO_TEST_JUMP sequences that form switch cases
        if (op.name === "MACRO_TEST_JUMP_EQ" || op.name === "MACRO_TEST_JUMP_NOT_EQ") {
            const testReg = op.data[1]; // the register being tested
            const cases = [];

            let j = i;
            while (j < opcodes.length &&
                   (opcodes[j].name === "MACRO_TEST_JUMP_EQ" ||
                    opcodes[j].name === "MACRO_TEST_JUMP_NOT_EQ") &&
                   opcodes[j].data[1] === testReg) {
                cases.push({
                    opcodeIndex: j,
                    testReg,
                    jumpReg: opcodes[j].data[2],
                    isEq: opcodes[j].name === "MACRO_TEST_JUMP_EQ"
                });
                j++;
            }

            if (cases.length >= 3) {
                patterns.push({
                    startIndex: i,
                    endIndex: j,
                    cases,
                    testReg
                });
            }
            i = j;
        } else {
            i++;
        }
    }

    return patterns;
}

/**
 * Replace a detected switch pattern with CFF_JUMP_TABLE.
 */
function replaceSwitchWithJumpTable(chunk, pattern, indexReg, stateReg, polyEndian) {
    const { cases, testReg } = pattern;
    const affine = generateAffineTransform();

    // Generate state IDs for each case
    const caseEntries = cases.map((c, idx) => {
        const caseValue = scrambleCaseValue(idx, affine.multiplier, affine.offset);
        const stateId = crypto.randomInt(1, 0x7FFFFFFF);
        return { caseValue, stateId, opcodeIndex: c.opcodeIndex };
    });

    const defaultStateId = crypto.randomInt(1, 0x7FFFFFFF);

    // Build preamble: compute index from test register and apply affine transform
    const preamble = [
        new Opcode("SET", indexReg, testReg),
        new Opcode("LOAD_DWORD", stateReg, encodeDWORD(affine.multiplier, polyEndian)),
        new Opcode("MULTIPLY", indexReg, indexReg, stateReg),
        new Opcode("LOAD_DWORD", stateReg, encodeDWORD(affine.offset, polyEndian)),
        new Opcode("ADD", indexReg, indexReg, stateReg),
    ];

    // Build the jump table opcode
    const jumpTable = buildJumpTableOpcode(indexReg, cases, defaultStateId, polyEndian);

    // Replace opcodes in chunk
    const newOpcodes = [
        ...chunk.code.slice(0, pattern.startIndex),
        ...preamble,
        jumpTable,
        ...chunk.code.slice(pattern.endIndex)
    ];

    chunk.code = newOpcodes;
    return caseEntries;
}

/**
 * Apply multi-level CFF - nests one CFF dispatch inside another.
 * Creates a two-level state machine for higher resistance.
 *
 * @param {VMChunk} chunk
 * @param {number} outerStateReg
 * @param {number} innerStateReg
 * @param {object} options
 */
function applyMultiLevelCFF(chunk, outerStateReg, innerStateReg, options = {}) {
    const polyEndian = options.polyEndian || "BE";
    const opcodes = chunk.code;

    if (opcodes.length < 8) return { initialStateId: 0 };

    // Phase 1: Group opcodes into clusters of ~4-8 opcodes
    const clusterSize = 4 + crypto.randomInt(0, 5);
    const clusters = [];

    for (let i = 0; i < opcodes.length; i += clusterSize) {
        clusters.push({
            opcodes: opcodes.slice(i, i + clusterSize),
            startIndex: i,
            endIndex: Math.min(i + clusterSize, opcodes.length)
        });
    }

    if (clusters.length < 2) return { initialStateId: 0 };

    // Phase 2: Assign outer (cluster-level) and inner (opcode-level) state IDs
    const outerStateIds = new Map();
    const innerStateMaps = new Map();

    for (let c = 0; c < clusters.length; c++) {
        let outerId;
        do {
            outerId = crypto.randomInt(1, 0x7FFFFFFF);
        } while ([...outerStateIds.values()].includes(outerId));
        outerStateIds.set(c, outerId);

        const innerMap = new Map();
        for (let o = 0; o < clusters[c].opcodes.length; o++) {
            let innerId;
            do {
                innerId = crypto.randomInt(1, 0x7FFFFFFF);
            } while ([...innerMap.values()].includes(innerId));
            innerMap.set(o, innerId);
        }
        innerStateMaps.set(c, innerMap);
    }

    // Phase 3: Build computed goto for outer dispatch
    const outerEntries = [];
    for (let c = 0; c < clusters.length; c++) {
        outerEntries.push({
            key: scrambleCaseValue(c, 0x9e3779b9, 0x85ebca6b),
            stateId: outerStateIds.get(c)
        });
    }

    const initialStateId = outerStateIds.get(0);
    const shiftReg = outerStateReg === innerStateReg ? innerStateReg + 1 : innerStateReg;

    const outerGoto = buildComputedGotoOpcode(
        outerStateReg,
        shiftReg,
        outerEntries,
        0,
        polyEndian
    );

    // Phase 4: Build inner dispatch for each cluster
    const newOpcodes = [];
    const headerOpcodes = [
        new Opcode("LOAD_DWORD", outerStateReg, encodeDWORD(outerEntries[0].key, polyEndian)),
        new Opcode("LOAD_DWORD", innerStateReg, encodeDWORD(innerStateMaps.get(0).get(0), polyEndian)),
        new Opcode("JUMP_UNCONDITIONAL", encodeDWORD(0, polyEndian)), // patched later
    ];

    // Placeholder for outer dispatch
    const outerDispatchPos = headerOpcodes.length;
    headerOpcodes.push(outerGoto);

    // Build cluster blocks with inner dispatch
    const shuffledClusterIndices = shuffleArray([...Array(clusters.length).keys()]);

    for (const cIdx of shuffledClusterIndices) {
        const cluster = clusters[cIdx];
        const innerMap = innerStateMaps.get(cIdx);

        for (let o = 0; o < cluster.opcodes.length; o++) {
            newOpcodes.push(cluster.opcodes[o]);

            // After each opcode, set inner state to next opcode and jump to inner dispatch
            if (o < cluster.opcodes.length - 1) {
                newOpcodes.push(new Opcode("LOAD_DWORD", innerStateReg,
                    encodeDWORD(innerMap.get(o + 1), polyEndian)));
                newOpcodes.push(new Opcode("JUMP_UNCONDITIONAL", encodeDWORD(0, polyEndian)));
            } else {
                // End of cluster: set outer state to next cluster
                const nextCluster = cIdx + 1;
                if (nextCluster < clusters.length) {
                    const nextKey = scrambleCaseValue(nextCluster, 0x9e3779b9, 0x85ebca6b);
                    newOpcodes.push(new Opcode("LOAD_DWORD", outerStateReg,
                        encodeDWORD(nextKey, polyEndian)));
                    newOpcodes.push(new Opcode("LOAD_DWORD", innerStateReg,
                        encodeDWORD(innerStateMaps.get(nextCluster).get(0), polyEndian)));
                    newOpcodes.push(new Opcode("JUMP_UNCONDITIONAL", encodeDWORD(0, polyEndian)));
                }
            }
        }
    }

    // Assemble: header + outer dispatch + shuffled clusters
    const allOpcodes = [...headerOpcodes, ...newOpcodes];

    // Patch the header jump to point past the outer dispatch (we'll compute later)
    // For now, return the assembled chunk
    const newChunk = new VMChunk(chunk.metadata);
    newChunk.code = allOpcodes;

    return {
        chunk: newChunk,
        initialStateId,
        outerStateReg,
        innerStateReg
    };
}

module.exports = {
    buildJumpTableOpcode,
    buildComputedGotoOpcode,
    scrambleCaseValue,
    generateAffineTransform,
    applyJumpTableCFF,
    applyMultiLevelCFF,
    detectSwitchPatterns
};
