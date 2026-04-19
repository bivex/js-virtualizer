const {transpile} = require('./src/transpile');
const childProcess = require('child_process');
const path = require('path');
const fs = require('fs');

async function run() {
    const code = fs.readFileSync('sample/branching.js', 'utf-8');

    const result = await transpile(code, {
        fileName: 'debug_branching_nested',
        passes: ['RemoveUnused'],
        nestedVM: true,
        writeOutput: true
    });
    
    const orig = childProcess.execSync(`node sample/branching.js`).toString();
    console.log('Original output:', JSON.stringify(orig));
    
    // Replace CFF trampoline with original
    let vmCode = fs.readFileSync(result.vmOutputPath, 'utf-8');
    vmCode = vmCode.replace(
        /    CFF_DISPATCH: function \(\) \{[\s\S]*?\n    \},\n    SET:/,
        `    CFF_DISPATCH: function () {
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
    const patchedVmPath = result.vmOutputPath.replace('.vm.js', '.patchedcff.vm.js');
    fs.writeFileSync(patchedVmPath, vmCode);
    
    let vCode = fs.readFileSync(result.transpiledOutputPath, 'utf-8');
    const vmRelName = path.basename(result.vmOutputPath);
    const patchedRelName = path.basename(patchedVmPath);
    vCode = vCode.replace(new RegExp(vmRelName.replace(/\./g, '\\.'), 'g'), patchedRelName);
    const patchedVPath = result.transpiledOutputPath.replace('.virtualized.js', '.patchedcff.virtualized.js');
    fs.writeFileSync(patchedVPath, vCode);
    
    try {
        const out2 = childProcess.execSync(`node ${patchedVPath}`, { timeout: 5000 }).toString();
        console.log('Nested ADD + Original CFF:', JSON.stringify(out2));
        console.log('Match:', orig === out2);
    } catch(e) {
        console.error('Nested ADD + Original CFF error:', e.message);
    }
}

run().catch(console.error);
