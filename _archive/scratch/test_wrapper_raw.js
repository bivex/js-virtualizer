const acorn = require('acorn');
const { transpile } = require('../src/transpile');
const fs = require('fs');
const path = require('path');

const code = `
// @virtualize
function add(a, b) {
    return a + b;
}
// @virtualize
function sub(a, b) {
    return a - b;
}
console.log('Result:', add(10, 5), sub(10, 5));
`;

async function run() {
    const tempDir = fs.mkdtempSync(path.join(__dirname, '..', 'output', 'debug-'));
    console.log('Output dir:', tempDir);

    // Monkey-patch console.log to capture wrapper logs
    const origLog = console.log;
    const captured = [];
    console.log = function(...args) {
        const msg = args.join(' ');
        if (msg.includes('WRAPPER') || msg.includes('SETUP')) {
            captured.push(msg);
        }
        origLog.apply(console, args);
    };

    try {
        await transpile(code, {
            codeInterleaving: true,
            controlFlowFlattening: false,
            opaquePredicates: false,
            polymorphic: false,
            selfModifyingBytecode: false,
            antiDump: false,
            deadCodeInjection: false,
            junkInStream: false,
            dispatchObfuscation: false,
            whiteboxEncryption: false,
            timeLock: false,
            passes: [],
            fileName: 'debug-rawwrap',
            vmOutputPath: path.join(tempDir, 'raw.vm.js'),
            transpiledOutputPath: path.join(tempDir, 'raw.out.js')
        });
    } finally {
        console.log = origLog;
    }

    captured.forEach(c => console.log(c));

    // Also read and show the setup code from the output
    const outCode = fs.readFileSync(path.join(tempDir, 'raw.out.js'), 'utf-8');
    // Find __jsv_ilv_profile assignment to understand the profile
    const profileMatch = outCode.match(/var\s+\w+\s*=\s*\{[^}]*registerCount[^}]*\}/);
    if (profileMatch) {
        console.log('\nProfile:', profileMatch[0]);
    }

    // Now run it
    try {
        const { execSync } = require('child_process');
        const output = execSync(`node ${path.join(tempDir, 'raw.out.js')}`, { encoding: 'utf-8', timeout: 5000 });
        console.log('\nOutput:', output.trim());
    } catch(e) {
        console.log('\nError:', (e.stderr || e.message).substring(0, 800));
    }
}

run().catch(console.error);
