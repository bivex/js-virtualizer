const { transpile } = require('../src/transpile');
const { applyControlFlowFlattening, identifyBlocks } = require('../src/utils/cff');
const { interleaveChunks } = require('../src/utils/codeInterleaving');
const fs = require('fs');
const path = require('path');

const source = `
// @virtualize
function add(a, b) { return a + b; }
// @virtualize
function sub(a, b) { return a - b; }
console.log(add(10, 5), sub(10, 5));
`;

async function run() {
    for (const [label, passes] of [['no-passes', []], ['removeunused', ["RemoveUnused"]]]) {
        const tempDir = fs.mkdtempSync(path.join(__dirname, '..', 'output', 'blocks-'));
        const vmPath = path.join(tempDir, 'test.vm.js');
        const outPath = path.join(tempDir, 'test.out.js');
        
        await transpile(source, {
            codeInterleaving: true, controlFlowFlattening: false,
            polymorphic: false, opaquePredicates: false, selfModifyingBytecode: false,
            antiDump: false, junkInStream: false, dispatchObfuscation: false,
            whiteboxEncryption: false, deadCodeInjection: false, timeLock: false,
            passes, fileName: `blocks-${label}`, vmOutputPath: vmPath, transpiledOutputPath: outPath
        });
        
        // Read the transpiled output to extract the bytecode and manually check
        // Actually, let me just intercept the chunk before CFF by patching transpile
        // Instead, let me check the transpiled output structure
        const outCode = fs.readFileSync(outPath, 'utf-8');
        
        // Count opcodes in the output (look for loadFromString)
        const bytecodeMatch = outCode.match(/loadFromString\("([^"]+)"/);
        if (bytecodeMatch) {
            console.log(`${label}: bytecode length = ${bytecodeMatch[1].length}`);
        }
        
        // Check output
        const { execSync } = require('child_process');
        try {
            const output = execSync(`node ${outPath}`, { encoding: 'utf-8', timeout: 5000 });
            console.log(`${label}: output = ${output.trim()}`);
        } catch(e) {
            console.log(`${label}: error`);
        }
    }
}

run().catch(console.error);
