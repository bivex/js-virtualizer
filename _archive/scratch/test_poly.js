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
        const errLine = (e.stderr || e.message || '').split('\n').find(l => /Error|TypeError|RangeError/.test(l)) || '';
        console.log(`ERR  ${name}: ${errLine.trim().substring(0, 120)}`);
    }
}

async function run() {
    const allOff = {
        codeInterleaving: true,
        controlFlowFlattening: false, opaquePredicates: false, polymorphic: false,
        selfModifyingBytecode: false, antiDump: false, junkInStream: false,
        dispatchObfuscation: false, whiteboxEncryption: false, deadCodeInjection: false,
        timeLock: false, passes: []
    };

    console.log('=== Test polymorphic alone ===');
    await test('allOff', allOff);
    await test('poly-only', { ...allOff, polymorphic: true });

    console.log('\n=== Test with polymorphic=false, add others ===');
    await test('polyOff+cff', { ...allOff, controlFlowFlattening: true });
    await test('polyOff+opaque', { ...allOff, opaquePredicates: true });
    await test('polyOff+selfmod', { ...allOff, selfModifyingBytecode: true });
    await test('polyOff+antidump', { ...allOff, antiDump: true });
    await test('polyOff+junk', { ...allOff, junkInStream: true });
    await test('polyOff+dispatch', { ...allOff, dispatchObfuscation: true });
    await test('polyOff+whitebox', { ...allOff, whiteboxEncryption: true });

    console.log('\n=== Test poly=true + each other ===');
    const polyOn = { ...allOff, polymorphic: true };
    await test('poly+cff', { ...polyOn, controlFlowFlattening: true });
    await test('poly+dispatch', { ...polyOn, dispatchObfuscation: true });
    await test('poly+whitebox', { ...polyOn, whiteboxEncryption: true });
}

run().catch(console.error);
