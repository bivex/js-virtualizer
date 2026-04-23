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
    const tempDir = fs.mkdtempSync(path.join(__dirname, '..', 'output', 'narrow2-'));
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
    // Base: CFF + RemoveUnused + each protection individually
    const base = { codeInterleaving: true, passes: ["RemoveUnused"],
        polymorphic: false, opaquePredicates: false, selfModifyingBytecode: false,
        antiDump: false, junkInStream: false, dispatchObfuscation: false,
        whiteboxEncryption: false, deadCodeInjection: false, timeLock: false };
    
    console.log('=== Add one protection at a time to CFF+RU base ===');
    await test('cff+ru', base);
    await test('+poly', { ...base, polymorphic: true });
    await test('+opaque', { ...base, opaquePredicates: true });
    await test('+selfmod', { ...base, selfModifyingBytecode: true });
    await test('+antidump', { ...base, antiDump: true });
    await test('+junk', { ...base, junkInStream: true });
    await test('+dispatch', { ...base, dispatchObfuscation: true });
    await test('+whitebox', { ...base, whiteboxEncryption: true });
}

run().catch(console.error);
