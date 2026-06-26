const {transpile} = require('/Volumes/External/Code/js-virtualizer/src/transpile');
const fs=require('fs');
const cp=require('child_process');
const target = process.argv[2];
const orig=cp.execSync(`node /Volumes/External/Code/js-virtualizer/sample/${target}`).toString();
const base = {opaquePredicates:false,junkInStream:false,deadCodeInjection:false,controlFlowFlattening:false,selfModifyingBytecode:false,antiDump:false,timeLock:false,dispatchObfuscation:false,polymorphic:false,whiteboxEncryption:false};
async function trial(opts){
    const r = await transpile(fs.readFileSync(`/Volumes/External/Code/js-virtualizer/sample/${target}`,'utf-8'),Object.assign({fileName:`x_${Math.random().toString(36).slice(2,6)}.js`,passes:['RemoveUnused']},base,opts));
    try{return cp.execSync(`node ${r.transpiledOutputPath}`,{stdio:['pipe','pipe','pipe'],timeout:15000}).toString()===orig;}catch(e){return false;}
}
const adds = {opaque:{opaquePredicates:true}, junk:{junkInStream:true}, deadcode:{deadCodeInjection:true}, cff:{controlFlowFlattening:true}, smb:{selfModifyingBytecode:true}, antidump:{antiDump:true}, timelock:{timeLock:true}, dispatch:{dispatchObfuscation:true}, poly:{polymorphic:true}, whitebox:{whiteboxEncryption:true}};
(async()=>{
    const N=18;
    process.stdout.write(`${target} minimal `);
    let p=0; for(let i=0;i<N;i++) if(await trial({})) p++; process.stdout.write(`${p}/${N}\n`);
    for(const [n,o] of Object.entries(adds)){
        let p2=0; for(let i=0;i<N;i++) if(await trial(o)) p2++;
        process.stdout.write(`${target} +${n.padEnd(10)} ${p2}/${N}\n`);
    }
})();
