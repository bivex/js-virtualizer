const {transpile} = require('/Volumes/External/Code/js-virtualizer/src/transpile');
const fs=require('fs');
const cp=require('child_process');
const samples = ['ms.js','loops.js','patterns.js','objectarrays.js','protos.js','externalcalls.js'];
const orig = {};
for (const s of samples) orig[s] = cp.execSync(`node /Volumes/External/Code/js-virtualizer/sample/${s}`).toString();
async function trial(sample, opts) {
    const code = fs.readFileSync(`/Volumes/External/Code/js-virtualizer/sample/${sample}`,'utf-8');
    const r = await transpile(code, Object.assign({fileName:`t_${sample}_${Math.random().toString(36).slice(2,6)}`, passes:['RemoveUnused']}, opts));
    let out;
    try { out = cp.execSync(`node ${r.transpiledOutputPath}`, {stdio:['pipe','pipe','pipe']}).toString(); }
    catch(e) { out = 'CRASH'; }
    return out === orig[sample];
}
(async () => {
    const N = 12;
    for (const s of samples) {
        let bp=0;
        for (let i=0;i<N;i++){ if(await trial(s,{})) bp++; }
        process.stdout.write(`${s}: ${bp}/${N}\n`);
    }
})();
