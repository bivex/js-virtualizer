const { transpile } = require('../src/transpile');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const source = `
// @virtualize
function fib(n) {
    if (n <= 1) return n;
    let a = 0, b = 1;
    for (let i = 2; i <= n; i++) {
        const t = a + b;
        a = b;
        b = t;
    }
    return b;
}
console.log(fib(15));
`;

async function run() {
    const tempDir = fs.mkdtempSync(path.join(__dirname, '..', 'output', 'fib-cff-'));
    const vmPath = path.join(tempDir, 'test.vm.js');
    const outPath = path.join(tempDir, 'test.out.js');
    
    await transpile(source, {
        fileName: 'fib-cff',
        vmOutputPath: vmPath,
        transpiledOutputPath: outPath,
        passes: ["RemoveUnused"],
        controlFlowFlattening: true,
        codeInterleaving: false,
        polymorphic: false,
        opaquePredicates: false,
        selfModifyingBytecode: false,
        antiDump: false,
        junkInStream: false,
        dispatchObfuscation: false,
        whiteboxEncryption: false,
    });
    
    // Read transpiled output
    const outCode = fs.readFileSync(outPath, 'utf-8');
    
    const writes = [...outCode.matchAll(/VM\.write\((\d+),\s*(\d+)\)/g)];
    for (const w of writes) {
        const reg = parseInt(w[1]);
        const val = parseInt(w[2]);
        console.log(`VM.write(${reg}, ${val})  val & 0xFF = ${val & 0xFF}  hex = 0x${val.toString(16)}`);
    }
    
    // Check if CFF_DISPATCH is in the VM bytecode
    const vmCode = fs.readFileSync(vmPath, 'utf-8');
    const hasCffDispatch = vmCode.includes('CFF_DISPATCH');
    console.log('Has CFF_DISPATCH in VM:', hasCffDispatch);
    
    // Run it
    try {
        const output = execSync(`node ${outPath}`, { encoding: 'utf-8', timeout: 5000 });
        console.log('Output:', output.trim());
    } catch(e) {
        console.log('Error:', (e.stderr || e.stdout || '').substring(0, 500));
    }
}

run().catch(console.error);
