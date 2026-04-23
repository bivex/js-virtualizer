const { transpile } = require('../src/transpile');
const { applyControlFlowFlattening } = require('../src/utils/cff');
const { VMChunk, Opcode, encodeDWORD } = require('../src/utils/assembler');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const code = `
// @virtualize
function add(a, b) { return a + b; }
console.log(add(10, 20));
`;

async function run() {
    const tempDir = fs.mkdtempSync(path.join(__dirname, '..', 'output', 'cff-detail-'));
    const vmPath = path.join(tempDir, 'test.vm.js');
    const outPath = path.join(tempDir, 'test.out.js');
    
    await transpile(code, {
        fileName: 'cff-detail',
        vmOutputPath: vmPath,
        transpiledOutputPath: outPath,
        passes: ["RemoveUnused"],
        controlFlowFlattening: true,
        codeInterleaving: false,
        polymorphic: false,
        opaquePredicates: false,
        selfModifyingBytecode: false,
        antiDump: false,
        junkInStream: false,
        dispatchObfuscation: false,
        whiteboxEncryption: false,
    });
    
    // Read transpiled output to see cff init
    const outCode = fs.readFileSync(outPath, 'utf-8');
    
    // Find VM.write for CFF state
    const writes = [...outCode.matchAll(/VM\.write\((\d+),\s*(\d+)\)/g)];
    for (const w of writes) {
        const reg = parseInt(w[1]);
        const val = parseInt(w[2]);
        console.log(`VM.write(${reg}, ${val})  val & 0xFF = ${val & 0xFF}  val hex = 0x${val.toString(16)}`);
    }
    
    // Run it
    try {
        const output = execSync(`node ${outPath}`, { encoding: 'utf-8', timeout: 5000 });
        console.log('Output:', output.trim());
    } catch(e) {
        console.log('Error:', (e.stderr || e.stdout || '').substring(0, 300));
    }
}

run().catch(console.error);
