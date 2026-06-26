const {transpile} = require('/Volumes/External/Code/js-virtualizer/src/transpile');
const fs=require('fs'); const cp=require('child_process');
const code=fs.readFileSync('/Volumes/External/Code/js-virtualizer/sample/sequences.js','utf-8');
const orig=cp.execSync(`node /Volumes/External/Code/js-virtualizer/sample/sequences.js`).toString();
const min={opaquePredicates:true,junkInStream:false,deadCodeInjection:false,controlFlowFlattening:false,selfModifyingBytecode:false,antiDump:false,timeLock:false,dispatchObfuscation:false,polymorphic:true,whiteboxEncryption:false};
async function trial(opts){
    const r=await transpile(code,Object.assign({fileName:`o_${Math.random().toString(36).slice(2,6)}.js`,passes:['RemoveUnused']},min,opts));
    try{return cp.execSync(`node ${r.transpiledOutputPath}`,{stdio:['pipe','pipe','pipe'],timeout:15000}).toString()===orig;}catch(e){return false;}
}
(async()=>{
    const N=40;
    // opaque + polymorphic only (polymorphic enables scramble)
    let p=0; for(let i=0;i<N;i++) if(await trial({})) p++;
    process.stdout.write(`opaque+poly ${p}/${N}\n`);
    // opaque without polymorphic (no scramble)
    let p2=0; for(let i=0;i<N;i++) if(await trial({polymorphic:false})) p2++;
    process.stdout.write(`opaque only (no scramble) ${p2}/${N}\n`);
})();
