const { transpile } = require('../src/transpile');
const { interleaveChunks } = require('../src/utils/codeInterleaving');
const { VMChunk, Opcode, encodeDWORD } = require('../src/utils/assembler');
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');

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

    const vmPath = path.join(tempDir, 'trace.vm.js');
    const outPath = path.join(tempDir, 'trace.out.js');

    // Patch transpile temporarily to capture the ilv entries
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
        fileName: 'debug-trace',
        vmOutputPath: vmPath,
        transpiledOutputPath: outPath
    });

    // Now read the transpiled output and try to deobfuscate enough to see the wrapper
    const outCode = fs.readFileSync(outPath, 'utf-8');

    // Find function add() and function sub() bodies
    // They should have the wrapper code
    const addBody = outCode.match(/function add\s*\([^)]*\)\s*\{([\s\S]*?)\nfunction\s+sub/);
    if (addBody) {
        // Beautify by adding newlines
        const body = addBody[1]
            .replace(/;/g, ';\n')
            .replace(/\{/g, '{\n')
            .replace(/\}/g, '}\n');
        console.log('\n=== add wrapper (partial) ===');
        console.log(body.substring(0, 800));
    }

    // Try to just run the output with extra logging
    // Inject a log into __jsv_ilv_create to trace what happens
    const patched = outCode.replace(
        /function __jsv_ilv_create\(\)/,
        'function __jsv_ilv_create()'
    ).replace(
        /return _0x[a-f0-9]+\[([^\]]+)\]\(([^,]+),([^)]+)\),_0x[a-f0-9]+/,
        'console.log("VM created"),$1[$2]($3),$1'
    );

    const patchedPath = path.join(tempDir, 'trace.patched.js');
    fs.writeFileSync(patchedPath, patched);

    try {
        const { execSync } = require('child_process');
        const output = execSync(`node ${patchedPath}`, { encoding: 'utf-8', timeout: 5000 });
        console.log('\nPatched output:', output.trim());
    } catch(e) {
        console.log('\nPatched error:', (e.stderr || e.message).substring(0, 500));
    }
}

run().catch(console.error);
