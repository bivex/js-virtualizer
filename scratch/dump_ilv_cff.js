const { transpile } = require('../src/transpile');
const { interleaveChunks } = require('../src/utils/codeInterleaving');
const { applyControlFlowFlattening } = require('../src/utils/cff');
const { VMChunk, Opcode, encodeDWORD } = require('../src/utils/assembler');
const fs = require('fs');
const path = require('path');

const code = `
// @virtualize
function add(a, b) { return a + b; }
// @virtualize
function sub(a, b) { return a - b; }
console.log(add(10, 5), sub(10, 5));
`;

async function run() {
    const tempDir = fs.mkdtempSync(path.join(__dirname, '..', 'output', 'ilv-cff-'));
    const vmPath = path.join(tempDir, 'test.vm.js');
    const outPath = path.join(tempDir, 'test.out.js');
    
    await transpile(code, {
        codeInterleaving: true,
        controlFlowFlattening: true,
        polymorphic: false,
        opaquePredicates: false,
        selfModifyingBytecode: false,
        antiDump: false,
        junkInStream: false,
        dispatchObfuscation: false,
        whiteboxEncryption: false,
        deadCodeInjection: false,
        timeLock: false,
        passes: [],
        fileName: 'ilv-cff',
        vmOutputPath: vmPath,
        transpiledOutputPath: outPath
    });
    
    // Read transpiled output to see CFF init state
    const outCode = fs.readFileSync(outPath, 'utf-8');
    const cffMatch = outCode.match(/__jsv_ilv_cffInitState\s*=\s*(\d+)/);
    if (cffMatch) {
        console.log('CFF init state:', cffMatch[1]);
    }
    
    const selectorMatch = outCode.match(/__jsv_ilv_selectorReg\s*=\s*(\d+)/);
    if (selectorMatch) {
        console.log('Selector reg:', selectorMatch[1]);
    }
    
    // Run it
    const { execSync } = require('child_process');
    try {
        const output = execSync(`node ${outPath}`, { encoding: 'utf-8', timeout: 5000 });
        console.log('Output:', output.trim());
    } catch(e) {
        console.log('Error:', (e.stderr || e.stdout || e.message).substring(0, 500));
    }
}

run().catch(console.error);
