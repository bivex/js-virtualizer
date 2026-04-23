const { transpile } = require('../src/transpile');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const code = `
// @virtualize
function add(a, b) {
    return a + b;
}
// @virtualize
function sub(a, b) {
    return a - b;
}
console.log('Result:', add(10, 5), sub(10, 5));
`;

async function run() {
    const tempDir = fs.mkdtempSync(path.join(__dirname, '..', 'output', 'debug-'));
    const vmOutputPath = path.join(tempDir, 'debug.vm.js');
    const transpiledOutputPath = path.join(tempDir, 'debug.virtualized.js');

    await transpile(code, {
        codeInterleaving: true,
        controlFlowFlattening: false,  // disable CFF
        opaquePredicates: false,
        polymorphic: false,
        selfModifyingBytecode: false,
        antiDump: false,
        deadCodeInjection: false,
        fileName: 'debug-ilv',
        vmOutputPath,
        transpiledOutputPath
    });

    console.log('Running transpiled code...');
    const output = execSync(`node ${transpiledOutputPath}`, { encoding: 'utf-8' });
    console.log('Output:', output.trim());
}

run().catch(console.error);
