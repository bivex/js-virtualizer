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
    const tempDir = fs.mkdtempSync(path.join(__dirname, '..', 'output', 'min-'));
    const outPath = path.join(tempDir, 'test.out.js');
    try {
        await transpile(source, { ...opts, fileName: `test-${name}`,
            vmOutputPath: path.join(tempDir, 'test.vm.js'), transpiledOutputPath: outPath });
        const output = execSync(`node ${outPath}`, { encoding: 'utf-8', timeout: 5000 });
        const ok = output.trim() === '15 5';
        console.log(`${ok ? 'OK' : 'FAIL'} ${name}: ${output.trim()}`);
    } catch(e) {
        const errLine = (e.stderr || '').split('\n').find(l => /Error|TypeError/.test(l)) || '';
        console.log(`ERR  ${name}: ${errLine.trim().substring(0, 80)}`);
    }
}

async function run() {
    const base = { codeInterleaving: true, passes: ["RemoveUnused"] };
    
    // CFF + RemoveUnused only (no other protections)
    await test('cff+ru', { ...base, polymorphic: false, opaquePredicates: false,
        selfModifyingBytecode: false, antiDump: false, junkInStream: false,
        dispatchObfuscation: false, whiteboxEncryption: false, deadCodeInjection: false, timeLock: false });
    
    // No CFF, just RemoveUnused
    await test('ru-only', { ...base, controlFlowFlattening: false, polymorphic: false, opaquePredicates: false,
        selfModifyingBytecode: false, antiDump: false, junkInStream: false,
        dispatchObfuscation: false, whiteboxEncryption: false, deadCodeInjection: false, timeLock: false });
    
    // Full defaults
    await test('defaults', base);
    
    // Full defaults minus CFF
    await test('no-cff', { ...base, controlFlowFlattening: false });
}

run().catch(console.error);
