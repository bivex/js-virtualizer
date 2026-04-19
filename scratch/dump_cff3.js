const { VMChunk, Opcode, encodeDWORD } = require('../src/utils/assembler');
const { applyControlFlowFlattening } = require('../src/utils/cff');

// Build a chunk with branches to get enough blocks for CFF
const chunk = new VMChunk();
// LOAD r0, 10; LOAD r1, 5; EQ r2, r0, r1; JUMP_EQ r2, +offset; ADD r3, r0, r1; JUMP to end; SUB r3, r0, r1; END
// Block 1: LOAD, LOAD, EQ, JUMP_EQ
// Block 2: ADD, JUMP (after JUMP_EQ)
// Block 3: SUB (jump target)
// Block 4: END (after JUMP)

chunk.append(new Opcode("LOAD_DWORD", 0, encodeDWORD(10)));
chunk.append(new Opcode("LOAD_DWORD", 1, encodeDWORD(5)));
chunk.append(new Opcode("EQ", 2, 0, 1));

// JUMP_EQ: if r2 is true, jump to SUB block
// We need to calculate offset later, so use a placeholder first
chunk.append(new Opcode("JUMP_EQ", 2, encodeDWORD(0))); // placeholder

// Block 2: ADD + jump to END
chunk.append(new Opcode("ADD", 3, 0, 1));
// JUMP_UNCONDITIONAL to END - need to know END position
// For now, placeholder
chunk.append(new Opcode("JUMP_UNCONDITIONAL", encodeDWORD(0)));

// Block 3: SUB (target of JUMP_EQ)
const subPos = chunk.getCurrentIP();
chunk.append(new Opcode("SUB", 3, 0, 1));

// END
const endPos = chunk.getCurrentIP();
chunk.append(new Opcode("END"));

// Now patch jump offsets
// JUMP_EQ is at IP 18 (LOAD_DWORD=6, LOAD_DWORD=6, EQ=4, so JUMP_EQ at 18)
// JUMP_EQ cur = 19, target = subPos, offset = subPos - 19 + 1 = subPos - 18
const jumpEqOpcode = chunk.code[3];
const jumpEqOffset = subPos - 18;  // cur = 19, target = subPos, offset = subPos - 19 + 1
jumpEqOpcode.modifyArgs(encodeDWORD(jumpEqOffset));

// JUMP_UNCONDITIONAL is at IP 23 (after JUMP_EQ at 18+5=23)
// Wait, JUMP_EQ is at 18, size 5. ADD is at 23, size 4. JUMP_UNCONDITIONAL at 27, size 5.
// Actually let me compute:
// LOAD_DWORD: 1+1+4 = 6 bytes
// LOAD_DWORD: 6 bytes
// EQ: 1+1+1+1 = 4 bytes  
// JUMP_EQ: 1+1+4 = 6 bytes (wait, is it 6 or 5?)
// Let me check

console.log("Chunk opcodes:");
for (let i = 0; i < chunk.code.length; i++) {
    const op = chunk.code[i];
    console.log(`  [${i}] ${op.name} bytes=${op.toBytes().length} data=${op.data.toString('hex')}`);
}

let ip = 0;
const ips = [];
for (const op of chunk.code) {
    ips.push(ip);
    ip += op.toBytes().length;
}
console.log("IPs:", ips);
console.log("subPos:", subPos, "endPos:", endPos);

// Patch JUMP_EQ
const jumpEqIP = ips[3]; // JUMP_EQ at index 3
const jumpEqCur = jumpEqIP + 1;
const jumpEqTarget = ips[6]; // SUB at index 6
const eqOffset = jumpEqTarget - jumpEqCur + 1;
console.log(`JUMP_EQ at ${jumpEqIP}, cur=${jumpEqCur}, target=${jumpEqTarget}, offset=${eqOffset}`);
chunk.code[3].modifyArgs(encodeDWORD(eqOffset));

// Patch JUMP_UNCONDITIONAL  
const jumpUncondIP = ips[5]; // JUMP_UNCONDITIONAL at index 5
const jumpUncondCur = jumpUncondIP + 1;
const jumpUncondTarget = ips[7]; // END at index 7... wait, or should it be after SUB?
// After SUB, we need END. But there's no jump after SUB, it falls through to END.
// The JUMP_UNCONDITIONAL should jump to END.
const endIP = ips[chunk.code.length - 1]; // END opcode
const uncondOffset = endIP - jumpUncondCur + 1;
console.log(`JUMP_UNCONDITIONAL at ${jumpUncondIP}, cur=${jumpUncondCur}, target=${endIP}, offset=${uncondOffset}`);
chunk.code[5].modifyArgs(encodeDWORD(uncondOffset));

console.log("\nPatched chunk:");
console.log(chunk.toString());

// Now apply CFF
const cffResult = applyControlFlowFlattening(chunk, 5, { polyEndian: "BE" });
if (cffResult.chunk) {
    console.log("\nCFF applied. Initial state:", cffResult.initialStateId);
    console.log("Initial state & 0xFF:", cffResult.initialStateId & 0xFF);
    console.log("Initial state hex:", cffResult.initialStateId.toString(16));
    
    // Check first SET opcode
    const firstOp = cffResult.chunk.code[0];
    console.log("\nFirst opcode:", firstOp.name);
    console.log("Data bytes:", [...firstOp.data]);
    console.log("SET dest reg:", firstOp.data[0]);
    console.log("SET value (byte):", firstOp.data[1]);
    console.log("Expected initial state:", cffResult.initialStateId);
    
    console.log("\nCFF chunk:");
    console.log(cffResult.chunk.toString());
} else {
    console.log("CFF skipped, initialStateId:", cffResult.initialStateId);
}
