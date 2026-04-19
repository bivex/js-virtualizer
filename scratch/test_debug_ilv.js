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

    // Test with interleaving - minimal protections
    console.log('\n=== Interleaved (minimal) ===');
    const vmPath1 = path.join(tempDir, 'ilv.vm.js');
    const outPath1 = path.join(tempDir, 'ilv.out.js');
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
        fileName: 'debug-ilv-min',
        vmOutputPath: vmPath1,
        transpiledOutputPath: outPath1
    });

    // Show the wrapper functions
    const ilvOut = fs.readFileSync(outPath1, 'utf-8');
    // Find the wrapper functions
    const addMatch = ilvOut.match(/function add\([^)]*\)\{[^}]+\}/s);
    const subMatch = ilvOut.match(/function sub\([^)]*\)\{[^}]+\}/s);
    console.log('add wrapper:', addMatch ? addMatch[0].substring(0, 300) : 'NOT FOUND');
    console.log('sub wrapper:', subMatch ? subMatch[0].substring(0, 300) : 'NOT FOUND');

    // Show setup vars
    const selectorMatch = ilvOut.match(/__jsv_ilv_selectorReg\s*=\s*(\d+)/);
    const cffStateMatch = ilvOut.match(/__jsv_ilv_cffStateReg\s*=\s*(\d+)/);
    const profileMatch = ilvOut.match(/__jsv_ilv_profile\s*=\s*(\{[^;]+\})/);
    console.log('selectorReg:', selectorMatch ? selectorMatch[1] : 'NOT FOUND');
    console.log('cffStateReg:', cffStateMatch ? cffStateMatch[1] : 'NOT FOUND');
    if (profileMatch) {
        try {
            const p = eval('(' + profileMatch[1] + ')');
            console.log('profile.registerCount:', p.registerCount);
            console.log('profile keys:', Object.keys(p).join(', '));
        } catch(e) {
            console.log('profile parse error');
        }
    }

    // Try to run it
    try {
        const { execSync } = require('child_process');
        const output = execSync(`node ${outPath1}`, { encoding: 'utf-8', timeout: 5000 });
        console.log('Output:', output.trim());
    } catch(e) {
        console.log('Error:', e.stderr || e.message);
    }
}

run().catch(console.error);
