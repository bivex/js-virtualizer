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
    const cffOnly = { codeInterleaving: true, controlFlowFlattening: true,
        polymorphic: false, opaquePredicates: false, selfModifyingBytecode: false,
        antiDump: false, junkInStream: false, dispatchObfuscation: false,
        whiteboxEncryption: false, deadCodeInjection: false, timeLock: false };
    
    for (const [label, passes] of [['no-passes', []], ['removeunused', ["RemoveUnused"]]]) {
        const tempDir = fs.mkdtempSync(path.join(__dirname, '..', 'output', 'init-'));
        const outPath = path.join(tempDir, 'test.out.js');
        await transpile(source, { ...cffOnly, passes, fileName: `test-${label}`,
            vmOutputPath: path.join(tempDir, 'test.vm.js'), transpiledOutputPath: outPath });
        const outCode = fs.readFileSync(outPath, 'utf-8');
        const cffMatch = outCode.match(/__jsv_ilv_cffInitState\s*=\s*(\d+)/);
        const initState = cffMatch ? parseInt(cffMatch[1]) : 0;
        console.log(`${label}: cffInitState=${initState} (${initState === 0 ? 'CFF SKIPPED' : 'CFF APPLIED'})`);
        try {
            const output = execSync(`node ${outPath}`, { encoding: 'utf-8', timeout: 5000 });
            console.log(`  Output: ${output.trim()}`);
        } catch(e) {
            console.log(`  Error: ${(e.stderr || '').split('\n')[0].substring(0, 100)}`);
        }
    }
}

run().catch(console.error);
