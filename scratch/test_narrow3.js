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
    const tempDir = fs.mkdtempSync(path.join(__dirname, '..', 'output', 'narrow3-'));
    const outPath = path.join(tempDir, 'test.out.js');
    try {
        await transpile(source, { ...opts, fileName: `test-${name}`,
            vmOutputPath: path.join(tempDir, 'test.vm.js'), transpiledOutputPath: outPath });
        const output = execSync(`node ${outPath}`, { encoding: 'utf-8', timeout: 5000 });
        const ok = output.trim() === '15 5';
        console.log(`${ok ? 'OK' : 'FAIL'} ${name}: ${output.trim()}`);
    } catch(e) {
        const errLine = (e.stderr || '').split('\n').find(l => /Error|TypeError|RangeError/.test(l)) || '';
        console.log(`ERR  ${name}: ${errLine.trim().substring(0, 80)}`);
    }
}

async function run() {
    // Test opaque and antidump WITHOUT CFF
    const base = { codeInterleaving: true, passes: ["RemoveUnused"], controlFlowFlattening: false,
        polymorphic: false, selfModifyingBytecode: false, junkInStream: false,
        dispatchObfuscation: false, whiteboxEncryption: false, deadCodeInjection: false, timeLock: false };
    
    console.log('=== Without CFF ===');
    await test('no-cff+opaque', { ...base, opaquePredicates: true });
    await test('no-cff+antidump', { ...base, antiDump: true });
    
    console.log('\n=== With CFF ===');
    await test('cff+opaque', { ...base, controlFlowFlattening: true, opaquePredicates: true });
    await test('cff+antidump', { ...base, controlFlowFlattening: true, antiDump: true });
}

run().catch(console.error);
