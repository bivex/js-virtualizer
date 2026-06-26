const {transpile} = require('/Volumes/External/Code/js-virtualizer/src/transpile');
const fs=require('fs');
const cp=require('child_process');
const sample = process.argv[2] || 'protos.js';
const orig = cp.execSync(`node /Volumes/External/Code/js-virtualizer/sample/${sample}`).toString();
async function trial(opts) {
    const code = fs.readFileSync(`/Volumes/External/Code/js-virtualizer/sample/${sample}`,'utf-8');
    const r = await transpile(code, Object.assign({fileName:`b_${Math.random().toString(36).slice(2,6)}`, passes:['RemoveUnused']}, opts));
    let out;
    try { out = cp.execSync(`node ${r.transpiledOutputPath}`, {stdio:['pipe','pipe','pipe']}).toString(); }
    catch(e) { out = 'CRASH'; }
    return out === orig;
}
const configs = {
    baseline: {},
    no_opaque: {opaquePredicates:false},
    no_cff: {controlFlowFlattening:false},
    no_deadcode: {deadCodeInjection:false},
    no_junk: {junkInStream:false},
    no_poly: {polymorphic:false},
    no_smb: {selfModifyingBytecode:false},
    no_timeLock: {timeLock:false},
    no_dispatch: {dispatchObfuscation:false},
};
(async () => {
    const N = 10;
    for (const [name,opts] of Object.entries(configs)) {
        let p=0;
        for (let i=0;i<N;i++){ if(await trial(opts)) p++; }
        process.stdout.write(`${sample} ${name.padEnd(14)} ${p}/${N}\n`);
    }
})();
