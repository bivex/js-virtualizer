const {transpile} = require('/Volumes/External/Code/js-virtualizer/src/transpile');
const fs=require('fs'); const cp=require('child_process');
const code=fs.readFileSync('/Volumes/External/Code/js-virtualizer/sample/sequences.js','utf-8');
const orig=cp.execSync(`node /Volumes/External/Code/js-virtualizer/sample/sequences.js`).toString();
async function trial(opts){
    const r=await transpile(code,Object.assign({fileName:`q_${Math.random().toString(36).slice(2,6)}.js`,passes:['RemoveUnused']},opts));
    try{return cp.execSync(`node ${r.transpiledOutputPath}`,{stdio:['pipe','pipe','pipe'],timeout:15000}).toString()===orig;}catch(e){return false;}
}
(async()=>{
    const N=30;
    for(const [n,o] of Object.entries({full:{},no_opaque:{opaquePredicates:false},no_junk:{junkInStream:false},no_deadcode:{deadCodeInjection:false},no_cff:{controlFlowFlattening:false},no_smb:{selfModifyingBytecode:false},no_dispatch:{dispatchObfuscation:false}})){
        let p=0; for(let i=0;i<N;i++) if(await trial(o)) p++;
        process.stdout.write(`seq ${n.padEnd(12)} ${p}/${N}\n`);
    }
})();
