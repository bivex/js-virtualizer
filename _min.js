const {transpile} = require('/Volumes/External/Code/js-virtualizer/src/transpile');
const fs=require('fs'); const cp=require('child_process');
const code=fs.readFileSync('/Volumes/External/Code/js-virtualizer/sample/sequences.js','utf-8');
const orig=cp.execSync(`node /Volumes/External/Code/js-virtualizer/sample/sequences.js`).toString();
const min={opaquePredicates:false,junkInStream:false,deadCodeInjection:false,controlFlowFlattening:false,selfModifyingBytecode:false,antiDump:false,timeLock:false,dispatchObfuscation:false,polymorphic:false,whiteboxEncryption:false};
async function trial(opts){
    const r=await transpile(code,Object.assign({fileName:`m_${Math.random().toString(36).slice(2,6)}.js`,passes:['RemoveUnused']},min,opts));
    try{return cp.execSync(`node ${r.transpiledOutputPath}`,{stdio:['pipe','pipe','pipe'],timeout:15000}).toString()===orig;}catch(e){return false;}
}
(async()=>{
    const N=40;
    let p=0; for(let i=0;i<N;i++) if(await trial({})) p++;
    process.stdout.write(`seq minimal ${p}/${N}\n`);
    for(const [n,o] of Object.entries({opaque:{opaquePredicates:true},junk:{junkInStream:true},deadcode:{deadCodeInjection:true},cff:{controlFlowFlattening:true},smb:{selfModifyingBytecode:true},dispatch:{dispatchObfuscation:true},poly:{polymorphic:true},antidump:{antiDump:true},timelock:{timeLock:true},whitebox:{whiteboxEncryption:true}})){
        let pp=0; for(let i=0;i<N;i++) if(await trial(o)) pp++;
        process.stdout.write(`seq min+${n.padEnd(10)} ${pp}/${N}\n`);
    }
})();
