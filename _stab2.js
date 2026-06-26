const {transpile} = require('/Volumes/External/Code/js-virtualizer/src/transpile');
const fs=require('fs'); const cp=require('child_process');
async function trial(s){
    const code=fs.readFileSync('/Volumes/External/Code/js-virtualizer/sample/'+s,'utf-8');
    const orig=cp.execSync('node /Volumes/External/Code/js-virtualizer/sample/'+s).toString();
    const r=await transpile(code,{fileName:'z'+Math.random().toString(36).slice(2,6)+'.js',passes:['RemoveUnused']});
    try{return cp.execSync('node '+r.transpiledOutputPath,{stdio:['pipe','pipe','pipe'],timeout:15000}).toString()===orig;}catch(e){return false;}
}
(async()=>{
    const N=25;
    for(const s of ['sequences.js','fingerprint.js','protos.js','loops.js','ms.js']){
        let p=0; for(let i=0;i<N;i++) if(await trial(s)) p++;
        process.stdout.write(s.padEnd(20)+' '+p+'/'+N+'\n');
    }
})();
