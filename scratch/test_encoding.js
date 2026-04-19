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
    const tempDir = fs.mkdtempSync(path.join(__dirname, '..', 'output', 'enc-'));
    const outPath = path.join(tempDir, 'test.out.js');
    try {
        await transpile(code, {
            ...opts,
            fileName: `test-${name}`,
            vmOutputPath: path.join(tempDir, 'test.vm.js'),
            transpiledOutputPath: outPath
        });
        const output = execSync(`node ${outPath}`, { encoding: 'utf-8', timeout: 5000 });
        const result = output.trim();
        const ok = result === '15 5';
        console.log(`${ok ? 'OK' : 'FAIL'} ${name}: ${result}`);
    } catch(e) {
        const errLine = (e.stderr || e.message || '').split('\n').find(l => /Error|TypeError|RangeError/.test(l)) || '';
        console.log(`ERR  ${name}: ${errLine.trim().substring(0, 120)}`);
    }
}

async function run() {
    const base = {
        codeInterleaving: true,
        controlFlowFlattening: true,
        polymorphic: false, opaquePredicates: false,
        selfModifyingBytecode: false, antiDump: false, junkInStream: false,
        dispatchObfuscation: false, whiteboxEncryption: false,
        deadCodeInjection: false, timeLock: false, passes: []
    };

    // Test with CFF but bypass encoding by modifying the chunk after CFF
    console.log('=== With CFF + all encoding ===');
    await test('cff+enc', base);
    
    console.log('\n=== Without CFF ===');
    await test('no-cff', { ...base, controlFlowFlattening: false });
}

run().catch(console.error);
