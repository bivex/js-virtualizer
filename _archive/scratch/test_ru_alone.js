const { transpile } = require('../src/transpile');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const source = `
// @virtualize
function add(a, b) { return a + b; }
// @virtualize
function sub(a, b) { return a - b; }
console.log(add(10, 5), sub(10, 5));
`;

async function run() {
    // Without interleaving
    for (const [label, ilv] of [['no-ilv', false], ['ilv', true]]) {
        const tempDir = fs.mkdtempSync(path.join(__dirname, '..', 'output', 'ru-alone-'));
        const outPath = path.join(tempDir, 'test.out.js');
        await transpile(source, {
            codeInterleaving: ilv, controlFlowFlattening: false,
            polymorphic: false, opaquePredicates: false, selfModifyingBytecode: false,
            antiDump: false, junkInStream: false, dispatchObfuscation: false,
            whiteboxEncryption: false, deadCodeInjection: false, timeLock: false,
            passes: ["RemoveUnused"], fileName: `ru-alone-${label}`,
            vmOutputPath: path.join(tempDir, 'test.vm.js'), transpiledOutputPath: outPath
        });
        try {
            const output = execSync(`node ${outPath}`, { encoding: 'utf-8', timeout: 5000 });
            console.log(`${label}: ${output.trim()}`);
        } catch(e) {
            console.log(`${label}: error - ${(e.stderr || '').split('\n')[0].substring(0, 100)}`);
        }
    }
}

run().catch(console.error);
