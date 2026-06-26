const {transpile} = require('/Volumes/External/Code/js-virtualizer/src/transpile');
const fs=require('fs');
const cp=require('child_process');
const samples = ['ms.js','externalcalls.js','loops.js','patterns.js','objectarrays.js','protos.js','functionWithDefault.js'];
const orig = {};
for (const s of samples) orig[s] = cp.execSync(`node /Volumes/External/Code/js-virtualizer/sample/${s}`).toString();

async function trial(sample, opts) {
    const code = fs.readFileSync(`/Volumes/External/Code/js-virtualizer/sample/${sample}`,'utf-8');
    const r = await transpile(code, Object.assign({fileName:`t_${sample}`, passes:['RemoveUnused']}, opts));
    let out;
    try { out = cp.execSync(`node ${r.transpiledOutputPath}`, {stdio:['pipe','pipe','pipe']}).toString(); }
    catch(e) { out = 'CRASH'; }
    return out === orig[sample];
}
(async () => {
    const N = 25;
    for (const s of samples) {
        let bp=0,bf=0,jp=0,jf=0;
        for (let i=0;i<N;i++){ if(await trial(s,{})) bp++; else bf++; }
        for (let i=0;i<N;i++){ if(await trial(s,{junkInStream:false})) jp++; else jf++; }
        console.log(`${s.padEnd(24)} baseline ${bp}/${N}   no-junk ${jp}/${N}`);
    }
})();
