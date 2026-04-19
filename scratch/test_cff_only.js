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

async function test(name, opts) {
    const tempDir = fs.mkdtempSync(path.join(__dirname, '..', 'output', 'cff-only-'));
    const outPath = path.join(tempDir, 'test.out.js');
    try {
        await transpile(source, { ...opts, fileName: `test-${name}`,
            vmOutputPath: path.join(tempDir, 'test.vm.js'), transpiledOutputPath: outPath });
        const output = execSync(`node ${outPath}`, { encoding: 'utf-8', timeout: 5000 });
        const ok = output.trim() === '15 5';
        console.log(`${ok ? 'OK' : 'FAIL'} ${name}: ${output.trim()}`);
    } catch(e) {
        const errLine = (e.stderr || '').split('\n').find(l => /Error|TypeError|RangeError/.test(l)) || '';
        console.log(`ERR  ${name}: ${errLine.trim().substring(0, 100)}`);
    }
}

async function run() {
    const cffOnly = { codeInterleaving: true, controlFlowFlattening: true,
        polymorphic: false, opaquePredicates: false, selfModifyingBytecode: false,
        antiDump: false, junkInStream: false, dispatchObfuscation: false,
        whiteboxEncryption: false, deadCodeInjection: false, timeLock: false };
    
    for (let i = 0; i < 5; i++) {
        await test(`no-passes-${i}`, { ...cffOnly, passes: [] });
    }
    console.log('');
    for (let i = 0; i < 5; i++) {
        await test(`removeunused-${i}`, { ...cffOnly, passes: ["RemoveUnused"] });
    }
}

run().catch(console.error);
