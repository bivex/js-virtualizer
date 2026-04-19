const {transpile} = require('./src/transpile');
const fs = require('fs');
const path = require('path');

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

async function run() {
    const result = await transpile(code, {
        fileName: 'debug_trace_nested',
        passes: ['RemoveUnused'],
        nestedVM: true,
        writeOutput: true
    });

    // Patch the VM to add tracing to CFF_DISPATCH
    let vmCode = fs.readFileSync(result.vmOutputPath, 'utf-8');
    
    // Find CFF_DISPATCH handler and add tracing
    vmCode = vmCode.replace(
        `CFF_DISPATCH: function () {
        var cur = this.read(0);
        var stateReg = this.readByte();
        var currentState = this.read(stateReg);
        var numEntries = this.readDWORD();
        for (var i = 0; i < numEntries; i++) {
            var entryState = this.readDWORD();
            var entryOffset = this.readJumpTargetDWORD();
            if (currentState === entryState) {
                this.registers[0] = cur + entryOffset - 1;
                return;
            }
        }
    },`,
        `CFF_DISPATCH: function () {
        var cur = this.read(0);
        var stateReg = this.readByte();
        var currentState = this.read(stateReg);
        var numEntries = this.readDWORD();
        console.error('[CFF_DISPATCH] cur=' + cur + ' state=' + currentState + ' entries=' + numEntries);
        for (var i = 0; i < numEntries; i++) {
            var entryState = this.readDWORD();
            var entryOffset = this.readJumpTargetDWORD();
            console.error('  entry[' + i + '] state=' + entryState + ' offset=' + entryOffset + ' target=' + (cur + entryOffset - 1));
            if (currentState === entryState) {
                this.registers[0] = cur + entryOffset - 1;
                console.error('  -> MATCH! setting IP=' + (cur + entryOffset - 1));
                return;
            }
        }
        console.error('  -> NO MATCH!');
    },`
    );
    
    const tracedVmPath = result.vmOutputPath.replace('.vm.js', '.traced.vm.js');
    fs.writeFileSync(tracedVmPath, vmCode);
    
    // Update the virtualized file to use traced VM
    let vCode = fs.readFileSync(result.transpiledOutputPath, 'utf-8');
    vCode = vCode.replace(result.vmOutputPath.replace(/\\/g, '/'), tracedVmPath.replace(/\\/g, '/'));
    // Replace relative path reference
    const vmRelName = path.basename(result.vmOutputPath);
    const tracedRelName = path.basename(tracedVmPath);
    vCode = vCode.replace(vmRelName, tracedRelName);
    const tracedVPath = result.transpiledOutputPath.replace('.virtualized.js', '.traced.virtualized.js');
    fs.writeFileSync(tracedVPath, vCode);
    
    console.log('Traced VM at:', tracedVmPath);
    console.log('Traced virtualized at:', tracedVPath);
    console.log('Run with: node', tracedVPath);
}

run().catch(console.error);
