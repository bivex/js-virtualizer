const { transpile } = require('../src/transpile');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const code = `
// @virtualize
function add(a, b) { return a + b; }
// @virtualize
function sub(a, b) { return a - b; }
console.log(add(10, 5), sub(10, 5));
`;

async function test(name, opts) {
    const tempDir = fs.mkdtempSync(path.join(__dirname, '..', 'output', 'debug-'));
    const outPath = path.join(tempDir, 'test.out.js');
    try {
        await transpile(code, {
            ...opts,
            fileName: `test-${name}`,
            vmOutputPath: path.join(tempDir, 'test.vm.js'),
            transpiledOutputPath: outPath
        });
        const output = execSync(`node ${outPath}`, { encoding: 'utf-8', timeout: 10000 });
        const result = output.trim();
        const ok = result === '15 5';
        console.log(`${ok ? 'OK' : 'FAIL'} ${name}: ${result}`);
    } catch(e) {
        const errLine = (e.stderr || e.message || '').split('\n').find(l => l.includes('Error') || l.includes('TypeError') || l.includes('RangeError')) || '';
        console.log(`ERR  ${name}: ${errLine.trim().substring(0, 120)}`);
    }
}

async function run() {
    const base = { codeInterleaving: true, passes: ["RemoveUnused"] };

    // Test each protection alone (on top of minimal working base)
    const minimal = { ...base, controlFlowFlattening: false, opaquePredicates: false,
        selfModifyingBytecode: false, antiDump: false, junkInStream: false,
        dispatchObfuscation: false, whiteboxEncryption: false, deadCodeInjection: false, timeLock: false };

    console.log('=== Single protection on top of minimal ===');
    await test('min+cff', { ...minimal, controlFlowFlattening: true });
    await test('min+poly', { ...minimal, polymorphic: true });
    await test('min+opaque', { ...minimal, opaquePredicates: true });
    await test('min+selfmod', { ...minimal, selfModifyingBytecode: true });
    await test('min+antidump', { ...minimal, antiDump: true });
    await test('min+junk', { ...minimal, junkInStream: true });
    await test('min+dispatch', { ...minimal, dispatchObfuscation: true });
    await test('min+whitebox', { ...minimal, whiteboxEncryption: true });

    console.log('\n=== Remove one from full defaults ===');
    await test('defaults-no-cff', { ...base, controlFlowFlattening: false });
    await test('defaults-no-poly', { ...base, polymorphic: false });
    await test('defaults-no-opaque', { ...base, opaquePredicates: false });
    await test('defaults-no-selfmod', { ...base, selfModifyingBytecode: false });
    await test('defaults-no-antidump', { ...base, antiDump: false });
    await test('defaults-no-junk', { ...base, junkInStream: false });
    await test('defaults-no-dispatch', { ...base, dispatchObfuscation: false });
    await test('defaults-no-whitebox', { ...base, whiteboxEncryption: false });
}

run().catch(console.error);
