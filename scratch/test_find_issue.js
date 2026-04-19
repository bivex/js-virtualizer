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

const protectionSets = {
    'none': {
        codeInterleaving: true,
        controlFlowFlattening: false, opaquePredicates: false, polymorphic: false,
        selfModifyingBytecode: false, antiDump: false, junkInStream: false,
        dispatchObfuscation: false, whiteboxEncryption: false, timeLock: false,
        deadCodeInjection: false, passes: []
    },
    'test-defaults': {
        codeInterleaving: true,
        passes: ["RemoveUnused"]
    },
    'no-cff': { codeInterleaving: true, controlFlowFlattening: false, passes: ["RemoveUnused"] },
    'no-poly': { codeInterleaving: true, polymorphic: false, passes: ["RemoveUnused"] },
    'no-opaque': { codeInterleaving: true, opaquePredicates: false, passes: ["RemoveUnused"] },
    'no-selfmod': { codeInterleaving: true, selfModifyingBytecode: false, passes: ["RemoveUnused"] },
    'no-antidump': { codeInterleaving: true, antiDump: false, passes: ["RemoveUnused"] },
    'no-junk': { codeInterleaving: true, junkInStream: false, passes: ["RemoveUnused"] },
    'no-dispatch': { codeInterleaving: true, dispatchObfuscation: false, passes: ["RemoveUnused"] },
    'no-whitebox': { codeInterleaving: true, whiteboxEncryption: false, passes: ["RemoveUnused"] },
    'no-sm-no-ad-no-junk': {
        codeInterleaving: true, selfModifyingBytecode: false, antiDump: false,
        junkInStream: false, passes: ["RemoveUnused"]
    },
};

async function run() {
    for (const [name, opts] of Object.entries(protectionSets)) {
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
            const err = (e.stderr || e.message || '').split('\n').slice(0, 3).join(' | ');
            console.log(`ERR  ${name}: ${err.substring(0, 120)}`);
        }
    }
}

run().catch(console.error);
