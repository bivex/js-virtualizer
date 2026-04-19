const { Opcode, VMChunk, encodeDWORD } = require("./assembler");

function transformJumpTargetBytes(input, position, seed) {
    const result = new Array(4);
    for (let i = 0; i < 4; i++) {
        const pos = position + i;
        const key = ((seed >>> 0) ^ (pos * 17)) & 0xFF;
        result[i] = input[i] ^ key;
    }
    return result;
}
const crypto = require("crypto");

const BLOCK_TERMINATORS = new Set([
    "JUMP_UNCONDITIONAL",
    "JUMP_EQ",
    "JUMP_NOT_EQ",
    "MACRO_TEST_JUMP_EQ",
    "MACRO_TEST_JUMP_NOT_EQ",
    "END",
    "THROW",
    "THROW_ARGUMENT",
]);

const OPCODES_WITH_OFFSETS = new Set([
    "JUMP_UNCONDITIONAL",
    "JUMP_EQ",
    "JUMP_NOT_EQ",
    "MACRO_TEST_JUMP_EQ",
    "MACRO_TEST_JUMP_NOT_EQ",
    "TRY_CATCH_FINALLY",
    "VFUNC_CALL",
    "VFUNC_SETUP_CALLBACK",
]);

// Opaque blocks that should not be split internally
const OPAQUE_BLOCK_STARTS = new Set([
    "TRY_CATCH_FINALLY",
]);

function getOffsetPositionsInOpcode(opcode) {
    switch (opcode.name) {
        case "JUMP_UNCONDITIONAL":
            return [0];
        case "JUMP_EQ":
        case "JUMP_NOT_EQ":
            return [1];
        case "MACRO_TEST_JUMP_EQ":
        case "MACRO_TEST_JUMP_NOT_EQ":
            return [3];
        case "TRY_CATCH_FINALLY":
            return [1, 5];
        case "VFUNC_CALL":
            return [0];
        case "VFUNC_SETUP_CALLBACK":
            return [0];
        default:
            return [];
    }
}

function readOffsetFromData(data, pos) {
    return (data[pos] << 24) | (data[pos + 1] << 16) | (data[pos + 2] << 8) | data[pos + 3];
}

function writeOffsetToData(data, pos, value) {
    data[pos] = (value >> 24) & 0xFF;
    data[pos + 1] = (value >> 16) & 0xFF;
    data[pos + 2] = (value >> 8) & 0xFF;
    data[pos + 3] = value & 0xFF;
    return data;
}

function identifyBlocks(chunk) {
    const opcodes = chunk.code;
    if (opcodes.length === 0) return [];

    const leaders = new Set();
    leaders.add(0); // first opcode is always a leader

    // Build a map of byte positions to opcode indices
    const byteOffsets = [];
    let bytePos = 0;
    for (let i = 0; i < opcodes.length; i++) {
        byteOffsets.push(bytePos);
        bytePos += opcodes[i].toBytes().length;
    }

    // Map byte offset → opcode index
    const byteToIndex = new Map();
    for (let i = 0; i < opcodes.length; i++) {
        byteToIndex.set(byteOffsets[i], i);
    }

    for (let i = 0; i < opcodes.length; i++) {
        const opcode = opcodes[i];
        const offsetPositions = getOffsetPositionsInOpcode(opcode);

        // Mark jump targets as leaders
        if (opcode.name === "VFUNC_CALL" || opcode.name === "VFUNC_SETUP_CALLBACK") {
            const cur = byteOffsets[i] + 1;
            for (const pos of offsetPositions) {
                const offset = readOffsetFromData(opcode.data, pos);
                const targetByte = cur + offset - 1;
                const targetIdx = byteToIndex.get(targetByte);
                if (targetIdx !== undefined) {
                    leaders.add(targetIdx);
                }
            }
        } else if (offsetPositions.length > 0) {
            const cur = byteOffsets[i] + 1;
            for (const pos of offsetPositions) {
                const offset = readOffsetFromData(opcode.data, pos);
                const targetByte = cur + offset - 1;
                const targetIdx = byteToIndex.get(targetByte);
                if (targetIdx !== undefined) {
                    leaders.add(targetIdx);
                }
            }
        }

        // Instruction after a terminator is a leader
        if (BLOCK_TERMINATORS.has(opcode.name) && i + 1 < opcodes.length) {
            leaders.add(i + 1);
        }
    }

    // Sort leaders
    const sortedLeaders = [...leaders].sort((a, b) => a - b);

    // Build blocks
    const blocks = [];
    for (let b = 0; b < sortedLeaders.length; b++) {
        const start = sortedLeaders[b];
        const end = b + 1 < sortedLeaders.length ? sortedLeaders[b + 1] : opcodes.length;
        blocks.push({
            index: blocks.length,
            startOpcodeIndex: start,
            endOpcodeIndex: end,
            opcodes: opcodes.slice(start, end),
            byteOffset: byteOffsets[start],
        });
    }

    return blocks;
}

function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = crypto.randomInt(0, i + 1);
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

const UNSAFE_OPCODES = new Set([
    "TRY_CATCH_FINALLY",
    "VFUNC_CALL",
    "VFUNC_SETUP_CALLBACK",
    "VFUNC_RETURN",
]);

function applyControlFlowFlattening(chunk, cffStateReg, options = {}) {
    const polyEndian = options.polyEndian || "BE";
    const jumpTargetSeed = options.jumpTargetSeed;
    const opcodes = chunk.code;
    if (opcodes.length < 4) return { initialStateId: 0 };

    // Skip CFF for chunks containing opcodes with embedded offsets that
    // are difficult to rewrite correctly (TRY_CATCH, VFUNC)
    const hasUnsafe = opcodes.some(op => UNSAFE_OPCODES.has(op.name));
    if (hasUnsafe) return { initialStateId: 0 };

    const blocks = identifyBlocks(chunk);
    if (blocks.length < 3) return { initialStateId: 0 };

    // Compute byte offsets for original opcodes
    const originalByteOffsets = new Map();
    let bpos = 0;
    for (let i = 0; i < opcodes.length; i++) {
        originalByteOffsets.set(i, bpos);
        bpos += opcodes[i].toBytes().length;
    }

    // Assign random state IDs
    const stateIds = new Map();
    const usedStates = new Set();
    for (const block of blocks) {
        let stateId;
        do {
            stateId = crypto.randomInt(1, 0x7FFFFFFF);
        } while (usedStates.has(stateId));
        usedStates.add(stateId);
        stateIds.set(block.index, stateId);
    }
    const initialStateId = stateIds.get(0);

    // Determine successor blocks for each block
    function findBlockAtByteOffset(byteOffset) {
        for (const block of blocks) {
            if (block.byteOffset === byteOffset) return block;
        }
        return null;
    }

    function getJumpTargetBlock(opcode, opcodeIndex) {
        const cur = originalByteOffsets.get(opcodeIndex) + 1;
        const offsetPositions = getOffsetPositionsInOpcode(opcode);
        const targets = [];
        for (const pos of offsetPositions) {
            const offset = readOffsetFromData(opcode.data, pos);
            const targetByte = cur + offset - 1;
            const block = findBlockAtByteOffset(targetByte);
            if (block) targets.push({ pos, blockId: block.index, stateId: stateIds.get(block.index) });
        }
        return targets;
    }

    // Rewrite each block's terminal instruction and add dispatch jumps
    const rewrittenBlocks = [];
    for (const block of blocks) {
        const newOpcodes = [...block.opcodes];
        const lastOpcode = newOpcodes[newOpcodes.length - 1];

        if (lastOpcode.name === "END" || lastOpcode.name === "THROW" || lastOpcode.name === "THROW_ARGUMENT") {
            rewrittenBlocks.push({ ...block, opcodes: newOpcodes, stateId: stateIds.get(block.index) });
            continue;
        }

        if (lastOpcode.name === "JUMP_UNCONDITIONAL") {
            const targets = getJumpTargetBlock(lastOpcode, block.endOpcodeIndex - 1);
            newOpcodes.pop();
            if (targets.length > 0) {
                newOpcodes.push(new Opcode("LOAD_DWORD", cffStateReg, encodeDWORD(targets[0].stateId, polyEndian)));
            } else {
                const nextBlockIdx = block.index + 1;
                if (nextBlockIdx < blocks.length) {
                    newOpcodes.push(new Opcode("LOAD_DWORD", cffStateReg, encodeDWORD(stateIds.get(nextBlockIdx), polyEndian)));
                } else {
                    newOpcodes.push(lastOpcode);
                    rewrittenBlocks.push({ ...block, opcodes: newOpcodes, stateId: stateIds.get(block.index) });
                    continue;
                }
            }
            newOpcodes.push(new Opcode("JUMP_UNCONDITIONAL", encodeDWORD(0, polyEndian)));
            rewrittenBlocks.push({ ...block, opcodes: newOpcodes, stateId: stateIds.get(block.index), needsDispatchJump: true });
            continue;
        }

        if (lastOpcode.name === "JUMP_EQ" || lastOpcode.name === "JUMP_NOT_EQ") {
            const targets = getJumpTargetBlock(lastOpcode, block.endOpcodeIndex - 1);
            const takenState = targets.length > 0 ? targets[0].stateId : stateIds.get(block.index + 1);
            const nextBlockIdx = block.index + 1;
            const notTakenState = nextBlockIdx < blocks.length ? stateIds.get(nextBlockIdx) : 0;
            const condReg = lastOpcode.data[0];

            newOpcodes.pop();

            const takenStub = [
                new Opcode("LOAD_DWORD", cffStateReg, encodeDWORD(takenState, polyEndian)),
                new Opcode("JUMP_UNCONDITIONAL", encodeDWORD(0, polyEndian)),
            ];
            const takenStubBytes = takenStub.reduce((s, op) => s + op.toBytes().length, 0);

            const notTakenStub = [
                new Opcode("LOAD_DWORD", cffStateReg, encodeDWORD(notTakenState, polyEndian)),
                new Opcode("JUMP_UNCONDITIONAL", encodeDWORD(0, polyEndian)),
            ];

            const notTakenStubBytes = notTakenStub.reduce((s, op) => s + op.toBytes().length, 0);
            const condJumpOffset = notTakenStubBytes + 6;

            newOpcodes.push(new Opcode(lastOpcode.name, condReg, encodeDWORD(condJumpOffset, polyEndian)));
            notTakenStub.forEach(op => newOpcodes.push(op));
            takenStub.forEach(op => newOpcodes.push(op));

            rewrittenBlocks.push({ ...block, opcodes: newOpcodes, stateId: stateIds.get(block.index), needsDispatchJump: true });
            continue;
        }

        if (lastOpcode.name === "MACRO_TEST_JUMP_EQ" || lastOpcode.name === "MACRO_TEST_JUMP_NOT_EQ") {
            const targets = getJumpTargetBlock(lastOpcode, block.endOpcodeIndex - 1);
            const takenState = targets.length > 0 ? targets[0].stateId : stateIds.get(block.index + 1);
            const nextBlockIdx = block.index + 1;
            const notTakenState = nextBlockIdx < blocks.length ? stateIds.get(nextBlockIdx) : 0;

            const testDest = lastOpcode.data[0];
            const testSrc = lastOpcode.data[1];
            const jumpReg = lastOpcode.data[2];

            newOpcodes.pop();

            const notTakenStub = [
                new Opcode("LOAD_DWORD", cffStateReg, encodeDWORD(notTakenState, polyEndian)),
                new Opcode("JUMP_UNCONDITIONAL", encodeDWORD(0, polyEndian)),
            ];
            const notTakenStubBytes = notTakenStub.reduce((s, op) => s + op.toBytes().length, 0);

            const takenStub = [
                new Opcode("LOAD_DWORD", cffStateReg, encodeDWORD(takenState, polyEndian)),
                new Opcode("JUMP_UNCONDITIONAL", encodeDWORD(0, polyEndian)),
            ];

            const condJumpOffset = notTakenStubBytes + 6;
            const condJumpName = lastOpcode.name === "MACRO_TEST_JUMP_EQ" ? "JUMP_EQ" : "JUMP_NOT_EQ";

            newOpcodes.push(new Opcode("TEST", testDest, testSrc));
            newOpcodes.push(new Opcode(condJumpName, jumpReg, encodeDWORD(condJumpOffset, polyEndian)));
            notTakenStub.forEach(op => newOpcodes.push(op));
            takenStub.forEach(op => newOpcodes.push(op));

            rewrittenBlocks.push({ ...block, opcodes: newOpcodes, stateId: stateIds.get(block.index), needsDispatchJump: true });
            continue;
        }

        const nextBlockIdx = block.index + 1;
        if (nextBlockIdx < blocks.length) {
            newOpcodes.push(new Opcode("SET", cffStateReg, stateIds.get(nextBlockIdx)));
            newOpcodes.push(new Opcode("JUMP_UNCONDITIONAL", encodeDWORD(0, polyEndian)));
            rewrittenBlocks.push({ ...block, opcodes: newOpcodes, stateId: stateIds.get(block.index), needsDispatchJump: true });
        } else {
            rewrittenBlocks.push({ ...block, opcodes: newOpcodes, stateId: stateIds.get(block.index) });
        }
    }

    const blockIndices = rewrittenBlocks.map((_, i) => i);
    shuffleArray(blockIndices);

    const blockSizes = rewrittenBlocks.map(b => b.opcodes.reduce((s, op) => s + op.toBytes().length, 0));
    const numEntries = rewrittenBlocks.length;

    const realHeaderSize = 3 + 5; // SET(3) + JUMP(5)
    const realDispatchByteOffset = realHeaderSize;

    const headerOpcodes = [
        new Opcode("SET", cffStateReg, initialStateId),
        new Opcode("JUMP_UNCONDITIONAL", encodeDWORD(realDispatchByteOffset - 3, polyEndian)),
    ];

    const dispatchData = Buffer.alloc(1 + 4 + numEntries * 8);
    dispatchData[0] = cffStateReg;
    const writeU32 = (polyEndian === "LE") ? "writeUInt32LE" : "writeUInt32BE";
    const writeI32 = (polyEndian === "LE") ? "writeInt32LE" : "writeInt32BE";
    dispatchData[writeU32](numEntries, 1);

    const blocksStartOffset = realHeaderSize + (1 + 1 + 4 + numEntries * 8);
    let currentOffset = blocksStartOffset;
    const shuffledBlockOffsets = new Map();
    for (const blockIdx of blockIndices) {
        shuffledBlockOffsets.set(blockIdx, currentOffset);
        currentOffset += blockSizes[blockIdx];
    }
for (let i = 0; i < numEntries; i++) {
    const blockIdx = blockIndices[i];
    const stateId = stateIds.get(blockIdx);
    const blockOffset = shuffledBlockOffsets.get(blockIdx);
    const entryOffset = blockOffset - realDispatchByteOffset;
    const entryBase = 5 + i * 8;
    dispatchData[writeU32](stateId, entryBase);
    let offsetBytes = Buffer.alloc(4);
    offsetBytes[writeI32](entryOffset, 0);
    dispatchData.set(offsetBytes, entryBase + 4);
    }

    const dispatchOpcode = new Opcode("CFF_DISPATCH", dispatchData);
    const allOpcodes = [...headerOpcodes, dispatchOpcode];
    let rebuildPos = realHeaderSize + dispatchOpcode.toBytes().length;

    for (const blockIdx of blockIndices) {
        const block = rewrittenBlocks[blockIdx];
        for (const op of block.opcodes) {
            if (op.name === "JUMP_UNCONDITIONAL" && op.data.length === 4 && op.data.readInt32BE(0) === 0) {
                const offset = realDispatchByteOffset - rebuildPos;
                op.modifyArgs(encodeDWORD(offset, polyEndian));
            }
            allOpcodes.push(op);
            rebuildPos += op.toBytes().length;
        }
    }

    const newChunk = new VMChunk(chunk.metadata);
    newChunk.code = allOpcodes;
    return { chunk: newChunk, initialStateId };
}

function applyMultiChunkControlFlowFlattening(chunks, cffStateReg, options = {}) {
    const polyEndian = options.polyEndian || "BE";
    const jumpTargetSeed = options.jumpTargetSeed;

    const allRewrittenBlocks = [];
    const chunkInitialStateIds = [];
    const usedStates = new Set();

    for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
        const chunk = chunks[chunkIdx];
        const opcodes = chunk.code;
        console.log(`DEBUG: Processing chunk ${chunkIdx}, opcodes: ${opcodes.length}`);

        const hasUnsafe = opcodes.some(op => UNSAFE_OPCODES.has(op.name));
        if (hasUnsafe) throw new Error(`Chunk ${chunkIdx} contains unsafe opcodes for CFF`);

        const blocks = identifyBlocks(chunk);
        // Фильтруем мусорные блоки (пустые или состоящие только из NOP)
        const validBlocks = blocks.filter(b => b.opcodes.length > 0 && !b.opcodes.every(o => o.name === 'NOP'));
        console.log(`DEBUG: Chunk ${chunkIdx} identified ${blocks.length} blocks, kept ${validBlocks.length} valid blocks`);

        const originalByteOffsets = new Map();
        let bpos = 0;
        for (let i = 0; i < opcodes.length; i++) {
            originalByteOffsets.set(i, bpos);
            bpos += opcodes[i].toBytes().length;
        }
        const totalChunkSize = bpos;
        console.log(`DEBUG: Chunk ${chunkIdx} total size: ${totalChunkSize}`);

        const stateIds = new Map();
        for (let i = 0; i < validBlocks.length; i++) {
            let stateId;
            do {
                stateId = crypto.randomInt(1, 0x7FFFFFFF);
            } while (usedStates.has(stateId));
            usedStates.add(stateId);
            stateIds.set(validBlocks[i].index, stateId);
        }
        chunkInitialStateIds.push(stateIds.get(validBlocks[0].index));
        console.log(`DEBUG: Chunk ${chunkIdx} initialStateId: ${stateIds.get(validBlocks[0].index)}`);

        function findBlockAtByteOffset(byteOffset) {
            const originalBlock = blocks.find(b => b.byteOffset === byteOffset);
            if (!originalBlock) {
                if (byteOffset === totalChunkSize) {
                    console.log(`DEBUG:   Target byte ${byteOffset} is at end of chunk`);
                }
                return null;
            }
            return validBlocks.find(vb => vb.index >= originalBlock.index) || null;
        }

        function getJumpTargetBlock(opcode, opcodeIndex) {
            const cur = originalByteOffsets.get(opcodeIndex) + 1;
            const offsetPositions = getOffsetPositionsInOpcode(opcode);
            const targets = [];
            for (const pos of offsetPositions) {
                const offset = readOffsetFromData(opcode.data, pos);
                const targetByte = cur + offset - 1;
                const block = findBlockAtByteOffset(targetByte);
                if (block) {
                    targets.push({ pos, blockId: block.index, stateId: stateIds.get(block.index) });
                    console.log(`DEBUG:   Opcode ${opcode.name} at idx ${opcodeIndex} targets byte ${targetByte} -> block ${block.index} [state ${stateIds.get(block.index)}]`);
                } else {
                    console.log(`DEBUG:   Opcode ${opcode.name} at idx ${opcodeIndex} targets byte ${targetByte} -> NO BLOCK FOUND`);
                }
            }
            return targets;
        }

        for (const block of validBlocks) {
            console.log(`DEBUG: Chunk ${chunkIdx} Block ${block.index} [state ${stateIds.get(block.index)}]: ${block.opcodes.map(o => o.name).join(', ')}`);
            const newOpcodes = [...block.opcodes];
            const lastOpcode = newOpcodes[newOpcodes.length - 1];
            let needsDispatchJump = false;

            if (lastOpcode.name === "END" || lastOpcode.name === "THROW" || lastOpcode.name === "THROW_ARGUMENT") {
                // Terminal - keep as is
            } else if (lastOpcode.name === "JUMP_UNCONDITIONAL") {
                const targets = getJumpTargetBlock(lastOpcode, block.endOpcodeIndex - 1);
                newOpcodes.pop();
                const targetState = targets.length > 0 ? targets[0].stateId : null;
                if (targetState) {
                    newOpcodes.push(new Opcode("SET", cffStateReg, targetState));
                    newOpcodes.push(new Opcode("JUMP_UNCONDITIONAL", encodeDWORD(0, polyEndian)));
                    needsDispatchJump = true;
                } else {
                    newOpcodes.push(new Opcode("END"));
                }
            } else if (lastOpcode.name === "JUMP_EQ" || lastOpcode.name === "JUMP_NOT_EQ") {
                const targets = getJumpTargetBlock(lastOpcode, block.endOpcodeIndex - 1);
                const takenState = targets.length > 0 ? targets[0].stateId : null;
                const nextBlock = validBlocks[validBlocks.indexOf(block) + 1];
                const notTakenState = nextBlock ? stateIds.get(nextBlock.index) : null;
                const condReg = lastOpcode.data[0];

                newOpcodes.pop();
                const takenStub = takenState ? [
                    new Opcode("SET", cffStateReg, takenState),
                    new Opcode("JUMP_UNCONDITIONAL", encodeDWORD(0, polyEndian)),
                ] : [new Opcode("END")];
                const notTakenStub = notTakenState ? [
                    new Opcode("SET", cffStateReg, notTakenState),
                    new Opcode("JUMP_UNCONDITIONAL", encodeDWORD(0, polyEndian)),
                ] : [new Opcode("END")];
                
                const notTakenStubBytes = notTakenStub.reduce((s, op) => s + op.toBytes().length, 0);
                newOpcodes.push(new Opcode(lastOpcode.name, condReg, encodeDWORD(notTakenStubBytes + 6, polyEndian)));
                notTakenStub.forEach(op => newOpcodes.push(op));
                takenStub.forEach(op => newOpcodes.push(op));
                needsDispatchJump = true;
            } else if (lastOpcode.name === "MACRO_TEST_JUMP_EQ" || lastOpcode.name === "MACRO_TEST_JUMP_NOT_EQ") {
                const targets = getJumpTargetBlock(lastOpcode, block.endOpcodeIndex - 1);
                const takenState = targets.length > 0 ? targets[0].stateId : null;
                const nextBlock = validBlocks[validBlocks.indexOf(block) + 1];
                const notTakenState = nextBlock ? stateIds.get(nextBlock.index) : null;
                const testDest = lastOpcode.data[0], testSrc = lastOpcode.data[1], jumpReg = lastOpcode.data[2];

                newOpcodes.pop();
                const notTakenStub = notTakenState ? [
                    new Opcode("LOAD_DWORD", cffStateReg, encodeDWORD(notTakenState, polyEndian)),
                    new Opcode("JUMP_UNCONDITIONAL", encodeDWORD(0, polyEndian)),
                ] : [new Opcode("END")];
                const takenStub = takenState ? [
                    new Opcode("LOAD_DWORD", cffStateReg, encodeDWORD(takenState, polyEndian)),
                    new Opcode("JUMP_UNCONDITIONAL", encodeDWORD(0, polyEndian)),
                ] : [new Opcode("END")];

                const notTakenStubBytes = notTakenStub.reduce((s, op) => s + op.toBytes().length, 0);
                const condJumpName = lastOpcode.name === "MACRO_TEST_JUMP_EQ" ? "JUMP_EQ" : "JUMP_NOT_EQ";
                newOpcodes.push(new Opcode("TEST", testDest, testSrc));
                newOpcodes.push(new Opcode(condJumpName, jumpReg, encodeDWORD(notTakenStubBytes + 6, polyEndian)));
                notTakenStub.forEach(op => newOpcodes.push(op));
                takenStub.forEach(op => newOpcodes.push(op));
                needsDispatchJump = true;
            } else {
                const nextBlock = validBlocks[validBlocks.indexOf(block) + 1];
                if (nextBlock) {
                    newOpcodes.push(new Opcode("LOAD_DWORD", cffStateReg, encodeDWORD(stateIds.get(nextBlock.index), polyEndian)));
                    newOpcodes.push(new Opcode("JUMP_UNCONDITIONAL", encodeDWORD(0, polyEndian)));
                    needsDispatchJump = true;
                } else {
                    newOpcodes.push(new Opcode("END"));
                }
            }

            allRewrittenBlocks.push({
                opcodes: newOpcodes,
                stateId: stateIds.get(block.index),
                needsDispatchJump
            });
        }
    }

    const blockIndices = allRewrittenBlocks.map((_, i) => i);
    shuffleArray(blockIndices);

    const numEntries = allRewrittenBlocks.length;
    const realHeaderSize = 1 + 5; // NOP(1) + JUMP_UNCONDITIONAL(5)
    const realDispatchByteOffset = realHeaderSize;

    const dispatchData = Buffer.alloc(1 + 4 + numEntries * 8);
    dispatchData[0] = cffStateReg;
    const writeU32 = (polyEndian === "LE") ? "writeUInt32LE" : "writeUInt32BE";
    const writeI32 = (polyEndian === "LE") ? "writeInt32LE" : "writeInt32BE";
    dispatchData[writeU32](numEntries, 1);

    const blocksStartOffset = realHeaderSize + (1 + 1 + 4 + numEntries * 8);
    let currentOffset = blocksStartOffset;
    const shuffledBlockOffsets = new Map();
    for (const idx of blockIndices) {
        shuffledBlockOffsets.set(idx, currentOffset);
        const size = allRewrittenBlocks[idx].opcodes.reduce((s, op) => s + op.toBytes().length, 0);
        currentOffset += size;
    }

    for (let i = 0; i < numEntries; i++) {
        const idx = blockIndices[i];
        const block = allRewrittenBlocks[idx];
        const entryBase = 5 + i * 8;
        dispatchData[writeU32](block.stateId, entryBase);
        const entryOffset = shuffledBlockOffsets.get(idx) - realDispatchByteOffset;
        let offsetBytes = Buffer.alloc(4);
        offsetBytes[writeI32](entryOffset, 0);
        dispatchData.set(offsetBytes, entryBase + 4);
    }

    const dispatchOpcode = new Opcode("CFF_DISPATCH", dispatchData);
    const resultOpcodes = [
        new Opcode("NOP"), // To be replaced by caller if needed
        new Opcode("JUMP_UNCONDITIONAL", encodeDWORD(realDispatchByteOffset - 1, polyEndian)), // JUMP dispatch
        dispatchOpcode
    ];

    let rebuildPos = resultOpcodes.reduce((s, op) => s + op.toBytes().length, 0);
    for (const idx of blockIndices) {
        const block = allRewrittenBlocks[idx];
        for (const op of block.opcodes) {
            if (op.name === "JUMP_UNCONDITIONAL" && op.data.length === 4) {
                const offset = polyEndian === "LE" ? op.data.readInt32LE(0) : op.data.readInt32BE(0);
                if (offset === 0) {
                    op.modifyArgs(encodeDWORD(realDispatchByteOffset - rebuildPos, polyEndian));
                }
            }
            resultOpcodes.push(op);
            rebuildPos += op.toBytes().length;
        }
    }

    const newChunk = new VMChunk();
    newChunk.code = resultOpcodes;
    return { chunk: newChunk, initialStateIds: chunkInitialStateIds };
}

module.exports = {
    applyControlFlowFlattening,
    applyMultiChunkControlFlowFlattening,
    identifyBlocks,
    getOffsetPositionsInOpcode,
    readOffsetFromData,
    UNSAFE_OPCODES
};
