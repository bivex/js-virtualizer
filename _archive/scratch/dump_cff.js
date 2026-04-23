const { transpile } = require('../src/transpile');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const code = `
// @virtualize
function add(a, b) { return a + b; }
console.log(add(10, 20));
`;

async function run() {
    const tempDir = fs.mkdtempSync(path.join(__dirname, '..', 'output', 'cff-'));
    const vmPath = path.join(tempDir, 'test.vm.js');
    const outPath = path.join(tempDir, 'test.out.js');
    
    await transpile(code, {
        fileName: 'cff-dump',
        vmOutputPath: vmPath,
        transpiledOutputPath: outPath,
        passes: ["RemoveUnused"],
        controlFlowFlattening: true,
        codeInterleaving: false
    });
    
    // Read the VM file and find CFF state init
    let vmCode = fs.readFileSync(vmPath, 'utf-8');
    
    // Find the cffInit write
    const cffMatches = [...vmCode.matchAll(/VM\.write\((\d+),\s*(\d+)\)/g)];
    for (const m of cffMatches) {
        console.log(`VM.write(${m[1]}, ${m[2]})`);
    }
    
    // Run it
    try {
        const output = execSync(`node ${outPath}`, { encoding: 'utf-8', timeout: 5000 });
        console.log('Output:', output.trim());
    } catch(e) {
        console.log('Error:', (e.stderr || '').substring(0, 500));
    }
}

run().catch(console.error);
