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
    const totalBytes = bytePos;

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
            // VFUNC offset is relative to cur (IP after opcode byte), pointing forward
            // cur = byteOffsets[i] + 1 (the byte after the opcode byte)
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
            // Jump offsets: cur = byteOffsets[i] + 1
            // target = cur + offset - 1 (for JUMP_*, MACRO_TEST_JUMP_*)
            // TRY_CATCH_FINALLY: catch/finally offsets also use cur + offset - 1
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

    // Verify all jump targets resolve to block boundaries
    const blockByteOffsets = new Set(blocks.map(b => b.byteOffset));
    for (let i = 0; i < opcodes.length; i++) {
        const opcode = opcodes[i];
        const offsetPositions = getOffsetPositionsInOpcode(opcode);
        if (offsetPositions.length > 0) {
            const cur = originalByteOffsets.get(i) + 1;
            for (const pos of offsetPositions) {
                const offset = readOffsetFromData(opcode.data, pos);
                const targetByte = cur + offset - 1;
                if (!blockByteOffsets.has(targetByte)) return { initialStateId: 0 };
            }
        }
    }

    // Build a reverse map: original byte offset → block index
    const byteOffsetToBlock = new Map();
    for (const block of blocks) {
        byteOffsetToBlock.set(block.byteOffset, block.index);
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
        // Find the block whose byteOffset matches
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
            // Terminal — keep as-is
            rewrittenBlocks.push({ ...block, opcodes: newOpcodes, stateId: stateIds.get(block.index) });
            continue;
        }

        if (lastOpcode.name === "JUMP_UNCONDITIONAL") {
            // Replace: SET cffReg, targetState; JUMP to dispatch
            const targets = getJumpTargetBlock(lastOpcode, block.endOpcodeIndex - 1);
            newOpcodes.pop(); // remove the original jump
            if (targets.length > 0) {
                newOpcodes.push(new Opcode("LOAD_DWORD", cffStateReg, encodeDWORD(targets[0].stateId, polyEndian)));
            } else {
                // Fallback: jump to next block
                const nextBlockIdx = block.index + 1;
                if (nextBlockIdx < blocks.length) {
                    newOpcodes.push(new Opcode("LOAD_DWORD", cffStateReg, encodeDWORD(stateIds.get(nextBlockIdx), polyEndian)));
                } else {
                    newOpcodes.push(lastOpcode);
                    rewrittenBlocks.push({ ...block, opcodes: newOpcodes, stateId: stateIds.get(block.index) });
                    continue;
                }
            }
            // Jump to dispatch placeholder — will be patched later
            newOpcodes.push(new Opcode("JUMP_UNCONDITIONAL", encodeDWORD(0, polyEndian)));
            rewrittenBlocks.push({ ...block, opcodes: newOpcodes, stateId: stateIds.get(block.index), needsDispatchJump: true });
            continue;
        }

        if (lastOpcode.name === "JUMP_EQ" || lastOpcode.name === "JUMP_NOT_EQ") {
            // Conditional jump: keep condition, rewrite targets
            const targets = getJumpTargetBlock(lastOpcode, block.endOpcodeIndex - 1);
            const takenState = targets.length > 0 ? targets[0].stateId : stateIds.get(block.index + 1);

            // Determine not-taken (fall-through) block
            const nextBlockIdx = block.index + 1;
            const notTakenState = nextBlockIdx < blocks.length ? stateIds.get(nextBlockIdx) : 0;

            // Keep the condition register
            const condReg = lastOpcode.data[0];

            // Rewrite: keep the conditional jump but redirect to taken-stub
            // Then fall-through to not-taken stub
            newOpcodes.pop(); // remove original conditional jump

            // Taken stub: SET cffReg, takenState; JUMP dispatch
            const takenStub = [
                new Opcode("LOAD_DWORD", cffStateReg, encodeDWORD(takenState, polyEndian)),
                new Opcode("JUMP_UNCONDITIONAL", encodeDWORD(0, polyEndian)), // patched later
            ];
            const takenStubBytes = takenStub.reduce((s, op) => s + op.toBytes().length, 0);

            // Not-taken stub: SET cffReg, notTakenState; JUMP dispatch
            const notTakenStub = [
                new Opcode("LOAD_DWORD", cffStateReg, encodeDWORD(notTakenState, polyEndian)),
                new Opcode("JUMP_UNCONDITIONAL", encodeDWORD(0, polyEndian)), // patched later
            ];

            // Conditional jump over not-taken stub to taken stub
            // Layout: [JUMP_EQ/NOT_EQ condReg, offset_to_taken_stub] [not-taken stub] [taken stub]
            // offset needs to skip over not-taken stub
            const notTakenStubBytes = notTakenStub.reduce((s, op) => s + op.toBytes().length, 0);
            // JUMP_EQ: cur = IP after opcode byte; reads reg(1) + offset(4) = 5 bytes
            // target = cur + offset - 1; we want target = cur + 5 + notTakenStubBytes
            // so offset = notTakenStubBytes + 6
            const condJumpOffset = notTakenStubBytes + 6;

            newOpcodes.push(new Opcode(lastOpcode.name, condReg, encodeDWORD(condJumpOffset, polyEndian)));
            notTakenStub.forEach(op => newOpcodes.push(op));
            takenStub.forEach(op => newOpcodes.push(op));

            rewrittenBlocks.push({ ...block, opcodes: newOpcodes, stateId: stateIds.get(block.index), needsDispatchJump: true });
            continue;
        }

        if (lastOpcode.name === "MACRO_TEST_JUMP_EQ" || lastOpcode.name === "MACRO_TEST_JUMP_NOT_EQ") {
            // Split back: TEST + conditional jump pattern
            const targets = getJumpTargetBlock(lastOpcode, block.endOpcodeIndex - 1);
            const takenState = targets.length > 0 ? targets[0].stateId : stateIds.get(block.index + 1);
            const nextBlockIdx = block.index + 1;
            const notTakenState = nextBlockIdx < blocks.length ? stateIds.get(nextBlockIdx) : 0;

            const testDest = lastOpcode.data[0];
            const testSrc = lastOpcode.data[1];
            const jumpReg = lastOpcode.data[2];

            newOpcodes.pop(); // remove MACRO_TEST_JUMP

            // Not-taken stub
            const notTakenStub = [
                new Opcode("LOAD_DWORD", cffStateReg, encodeDWORD(notTakenState, polyEndian)),
                new Opcode("JUMP_UNCONDITIONAL", encodeDWORD(0, polyEndian)),
            ];
            const notTakenStubBytes = notTakenStub.reduce((s, op) => s + op.toBytes().length, 0);

            // Taken stub
            const takenStub = [
                new Opcode("LOAD_DWORD", cffStateReg, encodeDWORD(takenState, polyEndian)),
                new Opcode("JUMP_UNCONDITIONAL", encodeDWORD(0, polyEndian)),
            ];

            // TEST + conditional jump over not-taken to taken
            const condJumpOffset = notTakenStubBytes + 6;
            const condJumpName = lastOpcode.name === "MACRO_TEST_JUMP_EQ" ? "JUMP_EQ" : "JUMP_NOT_EQ";

            newOpcodes.push(new Opcode("TEST", testDest, testSrc));
            newOpcodes.push(new Opcode(condJumpName, jumpReg, encodeDWORD(condJumpOffset, polyEndian)));
            notTakenStub.forEach(op => newOpcodes.push(op));
            takenStub.forEach(op => newOpcodes.push(op));

            rewrittenBlocks.push({ ...block, opcodes: newOpcodes, stateId: stateIds.get(block.index), needsDispatchJump: true });
            continue;
        }

        // Fall-through block: append SET + JUMP to dispatch
        const nextBlockIdx = block.index + 1;
        if (nextBlockIdx < blocks.length) {
            newOpcodes.push(new Opcode("LOAD_DWORD", cffStateReg, encodeDWORD(stateIds.get(nextBlockIdx), polyEndian)));
            newOpcodes.push(new Opcode("JUMP_UNCONDITIONAL", encodeDWORD(0, polyEndian)));
            rewrittenBlocks.push({ ...block, opcodes: newOpcodes, stateId: stateIds.get(block.index), needsDispatchJump: true });
        } else {
            rewrittenBlocks.push({ ...block, opcodes: newOpcodes, stateId: stateIds.get(block.index) });
        }
    }

    // Shuffle blocks (but keep the dispatch table first)
    // Create indices and shuffle
    const blockIndices = rewrittenBlocks.map((_, i) => i);
    shuffleArray(blockIndices);

    // Assemble the new chunk
    // Layout: [SET cffReg, initialState] [JUMP_UNCONDITIONAL to dispatch] [CFF_DISPATCH ...] [block0] [block1] ... [blockN]

    // First, compute sizes of each block to know the dispatch offset
    const blockSizes = rewrittenBlocks.map(b => b.opcodes.reduce((s, op) => s + op.toBytes().length, 0));

    // Header: SET(2 bytes) + JUMP_UNCONDITIONAL(5 bytes) = 7 bytes
    const headerSize = 6 + 5; // LOAD_DWORD(6) + JUMP_UNCONDITIONAL(5)

    // CFF_DISPATCH size: 1(opcode) + 1(stateReg) + 4(numEntries) + numEntries * 8 = 6 + numEntries*8
    const numEntries = rewrittenBlocks.length;
    const dispatchSize = 1 + 1 + 4 + numEntries * 8;

    // Dispatch starts after header
    const dispatchByteOffset = headerSize;

    // Blocks start after dispatch
    const blocksStartOffset = headerSize + dispatchSize;

    // Compute each shuffled block's byte offset
    const shuffledBlockOffsets = new Map();
    let currentOffset = blocksStartOffset;
    for (const blockIdx of blockIndices) {
        shuffledBlockOffsets.set(blockIdx, currentOffset);
        currentOffset += blockSizes[blockIdx];
    }

    // Build CFF_DISPATCH opcode data
    const dispatchData = Buffer.alloc(1 + 4 + numEntries * 8);
    dispatchData[0] = cffStateReg;

    const writeU32 = (polyEndian === "LE") ? "writeUInt32LE" : "writeUInt32BE";
    const writeI32 = (polyEndian === "LE") ? "writeInt32LE" : "writeInt32BE";

    dispatchData[writeU32](numEntries, 1);

    for (let i = 0; i < numEntries; i++) {
        const blockIdx = blockIndices[i];
        const stateId = stateIds.get(blockIdx);
        const blockOffset = shuffledBlockOffsets.get(blockIdx);
        // Store relative offset: VM does target = cur + offset - 1 where cur = dispatchByteOffset + 1
        // We want target = blockOffset, so offset = blockOffset - dispatchByteOffset
        const offset = blockOffset - dispatchByteOffset;
        const entryBase = 5 + i * 8;
        const entryOffsetPosition = entryBase + 4;
        dispatchData[writeU32](stateId, entryBase);
        let offsetBytes = Buffer.alloc(4);
        offsetBytes[writeI32](offset, 0);
        if (jumpTargetSeed) {
            offsetBytes = Buffer.from(transformJumpTargetBytes([...offsetBytes], entryOffsetPosition, jumpTargetSeed));
        }
        dispatchData.set(offsetBytes, entryOffsetPosition);
    }

    // Now patch all "JUMP_UNCONDITIONAL dispatch" instructions to point to the dispatch opcode
    for (const block of rewrittenBlocks) {
        if (!block.needsDispatchJump) continue;
        for (const opcode of block.opcodes) {
            if (opcode.name === "JUMP_UNCONDITIONAL" && opcode.data.length === 4) {
                // This is a dispatch jump — patch offset to point to CFF_DISPATCH
                // We need to know this opcode's byte position in the new layout
                // For now, mark it — we'll do a second pass
                opcode._isCffDispatchJump = true;
            }
        }
    }

    // Second pass: compute exact byte positions of each opcode and patch dispatch jumps
    // Build the full opcode array in shuffled order
    const headerOpcodes = [
        new Opcode("LOAD_DWORD", cffStateReg, encodeDWORD(initialStateId, polyEndian)),
        new Opcode("JUMP_UNCONDITIONAL", encodeDWORD(0, polyEndian)), // will be patched
    ];
    const dispatchOpcode = new Opcode("CFF_DISPATCH", dispatchData);

    // The header jump target: JUMP_UNCONDITIONAL needs to reach the CFF_DISPATCH
    // Header: SET(2) + JUMP(5) = 7 bytes. Dispatch is at offset 7.
    // JUMP_UNCONDITIONAL cur = offset after its opcode byte = 1 (SET is 2 bytes, JUMP opcode is at byte 2)
    // Actually, let's compute:
    // SET cffReg, stateId: opcode(1) + dest(1) + src(1) = wait, SET format is [dest, src]
    // SET = 1(opcode) + 1(dest) + 1(src) = 3 bytes... let me check

    // Looking at assembler: Opcode("SET", cffStateReg, initialStateId)
    // cffStateReg is a number → Buffer.from([number]) = 1 byte
    // initialStateId is a number → Buffer.from([number]) = 1 byte
    // So SET data = 2 bytes, total = 1(opcode) + 2(data) = 3 bytes

    // JUMP_UNCONDITIONAL = 1(opcode) + 4(data) = 5 bytes

    // Header = 6 + 5 = 11 bytes
    const realHeaderSize = 6 + 5; // LOAD_DWORD(6) + JUMP(5)
    const realDispatchByteOffset = realHeaderSize;

    // Patch header jump to dispatch
    // LOAD_DWORD is at byte 0, size 6. JUMP is at byte 6, size 5.
    // readOpcode reads byte 6 (JUMP opcode), IP = 7.
    // Handler: cur = this.read(IP) = 7.
    // readJumpTargetDWORD reads 4 bytes (IP 7-10), IP = 11.
    // Target = cur + offset - 1 = 7 + offset - 1 = 6 + offset.
    // We want target = realDispatchByteOffset (the CFF_DISPATCH opcode position).
    // So offset = realDispatchByteOffset - 6.
    headerOpcodes[1].modifyArgs(encodeDWORD(realDispatchByteOffset - 6, polyEndian));

    // Now assemble all blocks in shuffled order and compute their actual byte positions
    const allOpcodes = [...headerOpcodes, dispatchOpcode];

    // Track byte positions of all opcodes for patching dispatch jumps
    const opcodePositions = [];
    let pos = 0;
    for (const op of allOpcodes) {
        opcodePositions.push(pos);
        pos += op.toBytes().length;
    }

    // Add shuffled blocks and track positions
    for (const blockIdx of blockIndices) {
        const block = rewrittenBlocks[blockIdx];
        for (const op of block.opcodes) {
            opcodePositions.push(pos);
            pos += op.toBytes().length;
        }
    }

    // Now we need to build the full opcode array again with correct positions
    // Rebuild to patch dispatch jumps
    allOpcodes.length = 0;
    allOpcodes.push(...headerOpcodes, dispatchOpcode);

    let rebuildPos = realHeaderSize + dispatchOpcode.toBytes().length;

    for (const blockIdx of blockIndices) {
        const block = rewrittenBlocks[blockIdx];
        for (const op of block.opcodes) {
            if (op._isCffDispatchJump) {
                // Patch this JUMP_UNCONDITIONAL to point to the CFF_DISPATCH opcode
                // cur = rebuildPos + 1 (IP after this opcode's byte)
                // Actually: this opcode is at position rebuildPos
                // readOpcode reads byte at rebuildPos, IP = rebuildPos + 1
                // Handler: cur = this.read(IP) = rebuildPos + 1
                // readJumpTargetDWORD reads 4 bytes, IP = rebuildPos + 1 + 4 = rebuildPos + 5
                // Target = cur + offset - 1 = rebuildPos + 1 + offset - 1 = rebuildPos + offset
                // We want target = realDispatchByteOffset (position of CFF_DISPATCH)
                // So offset = realDispatchByteOffset - rebuildPos
                const offset = realDispatchByteOffset - rebuildPos;
                op.modifyArgs(encodeDWORD(offset, polyEndian));
                delete op._isCffDispatchJump;
            }
            allOpcodes.push(op);
            rebuildPos += op.toBytes().length;
        }
    }

    // Build the new chunk
    const newChunk = new VMChunk(chunk.metadata);
    newChunk.code = allOpcodes;
    return { chunk: newChunk, initialStateId };
}

module.exports = { applyControlFlowFlattening };
