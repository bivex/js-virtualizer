const {transpile} = require('/Volumes/External/Code/js-virtualizer/src/transpile');
const fs=require('fs');
const cp=require('child_process');
const samples = ['ms.js','loops.js','patterns.js','objectarrays.js','protos.js','externalcalls.js','functionWithDefault.js','switch.js'];
const orig={}; for(const s of samples) orig[s]=cp.execSync(`node /Volumes/External/Code/js-virtualizer/sample/${s}`).toString();
async function trial(s){
    const r = await transpile(fs.readFileSync(`/Volumes/External/Code/js-virtualizer/sample/${s}`,'utf-8'),{fileName:`s_${Math.random().toString(36).slice(2,6)}.js`,passes:['RemoveUnused']});
    try{return cp.execSync(`node ${r.transpiledOutputPath}`,{stdio:['pipe','pipe','pipe'],timeout:15000}).toString()===orig[s];}catch(e){return false;}
}
(async()=>{
    const N=20;
    for(const s of samples){
        let p=0; for(let i=0;i<N;i++) if(await trial(s)) p++;
        process.stdout.write(`${s.padEnd(24)} ${p}/${N}\n`);
    }
})();
