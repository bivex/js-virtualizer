const {transpile} = require('./src/transpile');
const childProcess = require('child_process');
const path = require('path');
const fs = require('fs');

// Test with nestedVM but without the ADD trampoline active
// We'll patch the generated VM to use the original ADD

async function run() {
    const code = `
// @virtualize
function evaluate() {
    const value = 0.5;
    if (value > 0.7) {
        return 1;
    } else {
        return 3;
    }
}
console.log(evaluate());
`;

    const result = await transpile(code, {
        fileName: 'debug_no_add_trampoline',
        passes: ['RemoveUnused'],
        nestedVM: true,
        writeOutput: true
    });
    
    // Patch the VM to replace ADD trampoline with original
    let vmCode = fs.readFileSync(result.vmOutputPath, 'utf-8');
    
    // Replace ADD trampoline with original
    vmCode = vmCode.replace(
        /ADD: function \(\) \{[\s\S]*?\},\n    SUBTRACT:/,
        `ADD: function () {
        const dest = this.readByte(), left = this.readByte(), right = this.readByte();
        this.write(dest, this.read(left) + this.read(right));
    },
    SUBTRACT:`
    );
    
    const patchedVmPath = result.vmOutputPath.replace('.vm.js', '.noadd.vm.js');
    fs.writeFileSync(patchedVmPath, vmCode);
    
    let vCode = fs.readFileSync(result.transpiledOutputPath, 'utf-8');
    const vmRelName = path.basename(result.vmOutputPath);
    const patchedRelName = path.basename(patchedVmPath);
    vCode = vCode.replace(new RegExp(vmRelName.replace('.', '\\.'), 'g'), patchedRelName);
    const patchedVPath = result.transpiledOutputPath.replace('.virtualized.js', '.noadd.virtualized.js');
    fs.writeFileSync(patchedVPath, vCode);
    
    try {
        const output = childProcess.execSync(`node ${patchedVPath}`, { timeout: 5000 }).toString();
        console.log('Output with original ADD:', JSON.stringify(output));
    } catch(e) {
        console.error('Error with original ADD:', e.message);
    }
    
    // Now try with original CFF_DISPATCH too
    let vmCode2 = fs.readFileSync(result.vmOutputPath, 'utf-8');
    vmCode2 = vmCode2.replace(
        /ADD: function \(\) \{[\s\S]*?\},\n    SUBTRACT:/,
        `ADD: function () {
        const dest = this.readByte(), left = this.readByte(), right = this.readByte();
        this.write(dest, this.read(left) + this.read(right));
    },
    SUBTRACT:`
    );
    vmCode2 = vmCode2.replace(
        /CFF_DISPATCH: function \(\) \{[\s\S]*?\},\n    SET:/,
        `CFF_DISPATCH: function () {
        const cur = this.read(registers.INSTRUCTION_POINTER);
        const stateReg = this.readByte();
        const currentState = this.read(stateReg);
        const numEntries = this.readDWORD();
        for (let i = 0; i < numEntries; i++) {
            const entryState = this.readDWORD();
            const entryOffset = this.readJumpTargetDWORD();
            if (currentState === entryState) {
                this.registers[registers.INSTRUCTION_POINTER] = cur + entryOffset - 1;
                return;
            }
        }
    },
    SET:`
    );
    
    const patchedVmPath2 = result.vmOutputPath.replace('.vm.js', '.orig.vm.js');
    fs.writeFileSync(patchedVmPath2, vmCode2);
    
    let vCode2 = fs.readFileSync(result.transpiledOutputPath, 'utf-8');
    vCode2 = vCode2.replace(new RegExp(vmRelName.replace('.', '\\.'), 'g'), path.basename(patchedVmPath2));
    const patchedVPath2 = result.transpiledOutputPath.replace('.virtualized.js', '.orig.virtualized.js');
    fs.writeFileSync(patchedVPath2, vCode2);
    
    try {
        const output2 = childProcess.execSync(`node ${patchedVPath2}`, { timeout: 5000 }).toString();
        console.log('Output with original ADD+CFF:', JSON.stringify(output2));
    } catch(e) {
        console.error('Error with original ADD+CFF:', e.message);
    }
}

run().catch(console.error);
