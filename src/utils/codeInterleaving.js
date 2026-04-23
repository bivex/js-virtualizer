/**
 * Code Interleaving (Function Merging)
 *
 * Merges bytecode from multiple virtualized functions into one chunk.
 * A selector dispatch preamble routes execution to the correct function's
 * entry point. After CFF, all blocks are shuffled together, making
 * individual functions inseparable.
 */

const { VMChunk, Opcode, encodeDWORD } = require("./assembler");

const SELECTOR_CHECK_SIZE = 6 + 4 + 6; // LOAD_DWORD + EQ + JUMP_EQ

function interleaveChunks(entries, registerCount, options = {}) {
    const endian = options.polyEndian ?? "BE";
    const selectorReg = registerCount - 2;
    const tempReg1 = registerCount - 3;
    const tempReg2 = registerCount - 4;
    const N = entries.length;

    if (N < 2) throw new Error("interleaveChunks requires at least 2 entries");

    // Phase 1: Compute sizes and positions
    const selectorPreambleSize = SELECTOR_CHECK_SIZE * N + 1; // + fallback END

    const adjustedFnSizes = entries.map(e => {
        const originalSize = e.chunk.toBytes().length;
        return originalSize - 1 + 5; // remove END (1 byte), add JUMP_UNCONDITIONAL (5 bytes)
    });

    const fnStartPositions = [];
    let fnPos = selectorPreambleSize;
    for (let i = 0; i < N; i++) {
        fnStartPositions.push(fnPos);
        fnPos += adjustedFnSizes[i];
    }
    const exitPosition = fnPos;

    // Phase 2: Build merged chunk
    const merged = new VMChunk();

    // Selector dispatch preamble
    for (let i = 0; i < N; i++) {
        const checkBase = i * SELECTOR_CHECK_SIZE;
        merged.append(new Opcode("LOAD_DWORD", tempReg1, encodeDWORD(i, endian)));

        merged.append(new Opcode("EQ", tempReg2, selectorReg, tempReg1));

        const jumpEqPos = checkBase + 6 + 4;
        const jumpEqOffset = fnStartPositions[i] - jumpEqPos; console.log("INTERLEAVE: fnStartPositions["+i+"]=", fnStartPositions[i], "adjustedFnSize=", adjustedFnSizes[i]);
        merged.append(new Opcode("JUMP_EQ", tempReg2, encodeDWORD(jumpEqOffset, endian)));
    }
    // Fallback END (unreachable if selector is valid)
    merged.append(new Opcode("END"));

    // Append each function's bytecode
    for (let i = 0; i < N; i++) {
        const code = entries[i].chunk.code;

        // Append all opcodes except the last one (END)
        for (let j = 0; j < code.length - 1; j++) {
            merged.append(code[j]);
        }

        // Replace END with JUMP_UNCONDITIONAL to exit
        const jumpExitPos = fnStartPositions[i] + adjustedFnSizes[i] - 5;
        const jumpExitOffset = exitPosition - jumpExitPos;
        merged.append(new Opcode("JUMP_UNCONDITIONAL", encodeDWORD(jumpExitOffset, endian)));
    }

    // Exit END
    merged.append(new Opcode("END"));

    return {
        mergedChunk: merged,
        selectorReg,
        fnStartPositions,
        exitPosition,
    };
}

module.exports = { interleaveChunks };
