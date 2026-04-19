const { Opcode, VMChunk, encodeDWORD } = require("./assembler");

function transformJumpTargetBytes(input, position, seed) {
    const result = new Array(4);
    for (let i = 0; i < 4; i++) {
        const pos = position + i;
        const key = ((seed >>> 0) ^ (pos * 17)) & 0xFF;
        result[i] = input[i] ^ key;
            }
            stateIds.set(validBlocks[i].index, stateId);
        }
        chunkInitialStateIds.push(stateIds.get(validBlocks[0].index));

        function findBlockAtByteOffset(byteOffset) {
            const originalBlock = blocks.find(b => b.byteOffset === byteOffset);
            if (!originalBlock) {
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
                }
            }
            return targets;
        }

        for (const block of validBlocks) {
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
                    new Opcode("SET", cffStateReg, notTakenState),
                    new Opcode("JUMP_UNCONDITIONAL", encodeDWORD(0, polyEndian)),
                ] : [new Opcode("END")];
                const takenStub = takenState ? [
                    new Opcode("SET", cffStateReg, takenState),
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
                    newOpcodes.push(new Opcode("SET", cffStateReg, stateIds.get(nextBlock.index)));
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
            if (op.name === "JUMP_UNCONDITIONAL" && op.data.length === 4 && op.data.readInt32BE(0) === 0) {
                op.modifyArgs(encodeDWORD(realDispatchByteOffset - rebuildPos, polyEndian));
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
