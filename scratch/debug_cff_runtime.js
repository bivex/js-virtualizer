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

async function run() {
    const tempDir = fs.mkdtempSync(path.join(__dirname, '..', 'output', 'dbg-'));
    const vmPath = path.join(tempDir, 'test.vm.js');
    const outPath = path.join(tempDir, 'test.out.js');
    
    await transpile(code, {
        codeInterleaving: true,
        controlFlowFlattening: true,
        polymorphic: false, opaquePredicates: false,
        selfModifyingBytecode: false, antiDump: false, junkInStream: false,
        dispatchObfuscation: false, whiteboxEncryption: false,
        deadCodeInjection: false, timeLock: false, passes: [],
        fileName: 'dbg-cff',
        vmOutputPath: vmPath,
        transpiledOutputPath: outPath
    });
    
    // Patch the VM to log CFF dispatch details
    let vmCode = fs.readFileSync(vmPath, 'utf-8');
    
    // Replace the CFF_DISPATCH handler with a logging version
    vmCode = vmCode.replace(
        /CFF_DISPATCH:\s*function\s*\(\)\s*\{\s*const cur = this\.read\(registers\.INSTRUCTION_POINTER\);/,
        'CFF_DISPATCH: function () { const cur = this.read(registers.INSTRUCTION_POINTER);'
    );
    
    // Add logging after finding match
    const origTarget = 'this.registers[registers.INSTRUCTION_POINTER] = cur + entryOffset - 1;';
    vmCode = vmCode.replace(
        origTarget,
        'const target = cur + entryOffset - 1; console.log("CFF: cur=" + cur + " state=" + currentState + " offset=" + entryOffset + " target=" + target + " codeLen=" + this.code.length); this.registers[registers.INSTRUCTION_POINTER] = target;'
    );
    
    // Add logging for END opcode
    vmCode = vmCode.replace(
        'if (opcode === undefined || opNames[opcode] === "END") {',
        'if (opcode === undefined || opNames[opcode] === "END") { console.log("END at IP=" + this.read(registers.INSTRUCTION_POINTER));'
    );
    
    fs.writeFileSync(vmPath, vmCode);
    
    try {
        const output = execSync(`node ${outPath}`, { encoding: 'utf-8', timeout: 10000 });
        console.log('Output:', output.trim());
    } catch(e) {
        const combined = (e.stdout || '') + '\n' + (e.stderr || '');
        console.log(combined.substring(0, 2000));
    }
}

run().catch(console.error);
