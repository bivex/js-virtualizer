const {transpile} = require('/Volumes/External/Code/js-virtualizer/src/transpile');
const fs=require('fs'); const cp=require('child_process');
const code=fs.readFileSync('/Volumes/External/Code/js-virtualizer/sample/sequences.js','utf-8');
const orig=cp.execSync(`node /Volumes/External/Code/js-virtualizer/sample/sequences.js`).toString();
(async()=>{
    for(let i=0;i<400;i++){
        const r=await transpile(code,{fileName:`cap_${i}.js`,passes:['RemoveUnused'],opaquePredicates:true,junkInStream:false,deadCodeInjection:false,controlFlowFlattening:false,selfModifyingBytecode:false,antiDump:false,timeLock:false,dispatchObfuscation:false,polymorphic:false,whiteboxEncryption:false});
        let out;
        try{out=cp.execSync(`node ${r.transpiledOutputPath}`,{stdio:['pipe','pipe','pipe'],timeout:15000}).toString();}catch(e){out='CRASH';}
        if(out!==orig){ console.log('FAIL#'+i, out.slice(0,20).replace(/\n/g,'/'), 'PATH', r.transpiledOutputPath); process.exit(0);}
    }
    console.log('none');
})();
