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
    const tempDir = fs.mkdtempSync(path.join(__dirname, '..', 'output', 'debug-'));
    const vmPath = path.join(tempDir, 'test.vm.js');
    const outPath = path.join(tempDir, 'test.out.js');

    await transpile(code, {
        codeInterleaving: true,
        controlFlowFlattening: true,
        polymorphic: false,
        opaquePredicates: false,
        selfModifyingBytecode: false,
        antiDump: false,
        junkInStream: false,
        dispatchObfuscation: false,
        whiteboxEncryption: false,
        deadCodeInjection: false,
        timeLock: false,
        passes: [],
        fileName: 'debug-cff',
        vmOutputPath: vmPath,
        transpiledOutputPath: outPath
    });

    // Patch the VM to add logging to CFF_DISPATCH handler
    let vmCode = fs.readFileSync(vmPath, 'utf-8');

    // Add logging to CFF_DISPATCH
    vmCode = vmCode.replace(
        /CFF_DISPATCH:\s*function\s*\(\)\s*\{/,
        'CFF_DISPATCH: function () {'
    );

    // Add debug log after finding the target
    vmCode = vmCode.replace(
        /this\.registers\[registers\.INSTRUCTION_POINTER\]\s*=\s*cur\s*\+\s*entryOffset\s*-\s*1;/,
        'console.log("CFF_DISPATCH: cur=" + cur + " entryOffset=" + entryOffset + " target=" + (cur + entryOffset - 1) + " state=" + currentState); this.registers[registers.INSTRUCTION_POINTER] = cur + entryOffset - 1;'
    );

    // Add debug log for END opcode
    vmCode = vmCode.replace(
        /log\(`\[IP = \${[^}]+\}:\ End of execution`\)/,
        'console.log("END at IP=" + this.read(registers.INSTRUCTION_POINTER))'
    );

    fs.writeFileSync(vmPath, vmCode);

    try {
        const output = execSync(`node ${outPath}`, { encoding: 'utf-8', timeout: 10000 });
        console.log('Output:', output.trim());
    } catch(e) {
        console.log('Error:', (e.stdout || '') + (e.stderr || '').substring(0, 500));
    }
}

run().catch(console.error);
