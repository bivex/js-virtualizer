const {transpile} = require('/Volumes/External/Code/js-virtualizer/src/transpile');
const fs=require('fs');
const cp=require('child_process');
const code=fs.readFileSync('/Volumes/External/Code/js-virtualizer/sample/loops.js','utf-8');
const orig = cp.execSync(`node /Volumes/External/Code/js-virtualizer/sample/loops.js`).toString();
const {opNames} = require('/Volumes/External/Code/js-virtualizer/src/utils/constants');
(async () => {
    // minimal obfuscation to keep bytecode decodable
    for (let i=0;i<300;i++){
        const r = await transpile(code, {
            fileName:`dc_${i}.js`,
            passes:['RemoveUnused'],
            opaquePredicates:false, junkInStream:false, deadCodeInjection:false,
            controlFlowFlattening:false, selfModifyingBytecode:false, antiDump:false,
            timeLock:false, dispatchObfuscation:false, polymorphic:false, whiteboxEncryption:false
        });
        let out;
        try { out = cp.execSync(`node ${r.transpiledOutputPath}`, {stdio:['pipe','pipe','pipe'],timeout:15000}).toString(); }
        catch(e){ out='CRASH'; }
        if (out!==orig) {
            console.log('Found mismatch at minimal config run', i, ':', out==='CRASH'?'CRASH':'CORRUPT');
            console.log('PATH:', r.transpiledOutputPath);
            console.log(r.bytecodeHex ? 'has hex':'no hex');
            process.exit(0);
        }
    }
    console.log('minimal config: 300 runs all pass');
})();
