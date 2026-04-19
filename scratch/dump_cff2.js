const { transpile } = require('../src/transpile');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { applyControlFlowFlattening } = require('../src/utils/cff');
const { VMChunk, Opcode, encodeDWORD } = require('../src/utils/assembler');

// Build a simple chunk manually and apply CFF
const chunk = new VMChunk();
// Simple: LOAD_DWORD r0, 10; LOAD_DWORD r1, 20; ADD r0, r0, r1; END
chunk.append(new Opcode("LOAD_DWORD", 0, encodeDWORD(10)));
chunk.append(new Opcode("LOAD_DWORD", 1, encodeDWORD(20)));
chunk.append(new Opcode("ADD", 2, 0, 1));
chunk.append(new Opcode("END"));

console.log("Original chunk:");
console.log(chunk.toString());
console.log("");

const cffResult = applyControlFlowFlattening(chunk, 5, { polyEndian: "BE" });
if (cffResult.chunk) {
    console.log("CFF applied. Initial state:", cffResult.initialStateId);
    console.log("Initial state (hex):", cffResult.initialStateId.toString(16));
    console.log("Initial state & 0xFF:", cffResult.initialStateId & 0xFF);
    console.log("");
    console.log("CFF chunk:");
    console.log(cffResult.chunk.toString());
    
    // Check the first SET opcode data
    const firstOp = cffResult.chunk.code[0];
    console.log("\nFirst opcode:", firstOp.name, "data:", firstOp.data.toString('hex'));
    console.log("First opcode data bytes:", [...firstOp.data]);
    console.log("stateId in SET:", firstOp.data[1]);
    console.log("Expected stateId:", cffResult.initialStateId);
} else {
    console.log("CFF returned no chunk, initialStateId:", cffResult.initialStateId);
}
