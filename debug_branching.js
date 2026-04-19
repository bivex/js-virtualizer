const {transpile} = require('./src/transpile');
const childProcess = require('child_process');
const path = require('path');
const fs = require('fs');

async function run() {
    // Test branching.js with nestedVM enabled
    const code = fs.readFileSync('sample/branching.js', 'utf-8');

    const result = await transpile(code, {
        fileName: 'debug_branching_nested',
        passes: ['RemoveUnused'],
        nestedVM: true,
        writeOutput: true
    });
    
    const orig = childProcess.execSync(`node sample/branching.js`).toString();
    console.log('Original output:', JSON.stringify(orig));
    
    // Run with both trampolines
    try {
        const out = childProcess.execSync(`node ${result.transpiledOutputPath}`, { timeout: 5000 }).toString();
        console.log('Nested VM output:', JSON.stringify(out));
        console.log('Match:', orig === out);
    } catch(e) {
        console.error('Nested VM error:', e.message);
    }
    
    // Test with original ADD but keeping CFF trampoline
    let vmCode = fs.readFileSync(result.vmOutputPath, 'utf-8');
    vmCode = vmCode.replace(
        /    ADD: function \(\) \{[\s\S]*?\n    \},\n    SUBTRACT:/,
        `    ADD: function () {
        const dest = this.readByte(), left = this.readByte(), right = this.readByte();
        this.write(dest, this.read(left) + this.read(right));
    },
    SUBTRACT:`
    );
    const patchedVmPath = result.vmOutputPath.replace('.vm.js', '.patchedadd.vm.js');
    fs.writeFileSync(patchedVmPath, vmCode);
    
    let vCode = fs.readFileSync(result.transpiledOutputPath, 'utf-8');
    const vmRelName = path.basename(result.vmOutputPath);
    const patchedRelName = path.basename(patchedVmPath);
    vCode = vCode.replace(new RegExp(vmRelName.replace(/\./g, '\\.'), 'g'), patchedRelName);
    const patchedVPath = result.transpiledOutputPath.replace('.virtualized.js', '.patchedadd.virtualized.js');
    fs.writeFileSync(patchedVPath, vCode);
    
    try {
        const out2 = childProcess.execSync(`node ${patchedVPath}`, { timeout: 5000 }).toString();
        console.log('Original ADD + CFF trampoline:', JSON.stringify(out2));
        console.log('Match:', orig === out2);
    } catch(e) {
        console.error('Original ADD + CFF trampoline error:', e.message);
    }
}

run().catch(console.error);
