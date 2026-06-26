const {transpile} = require('/Volumes/External/Code/js-virtualizer/src/transpile');
const fs=require('fs');
const cp=require('child_process');
const target = process.argv[2];
const orig = cp.execSync(`node /Volumes/External/Code/js-virtualizer/sample/${target}`).toString();
async function trial(opts){
    const r = await transpile(fs.readFileSync(`/Volumes/External/Code/js-virtualizer/sample/${target}`,'utf-8'), Object.assign({fileName:`f_${Math.random().toString(36).slice(2,6)}.js`, passes:['RemoveUnused']},opts));
    try { return cp.execSync(`node ${r.transpiledOutputPath}`,{stdio:['pipe','pipe','pipe'],timeout:15000}).toString()===orig; }
    catch(e){ return false; }
}
const cfgs = {baseline:{}, no_junk:{junkInStream:false}, no_opaque:{opaquePredicates:false}, no_deadcode:{deadCodeInjection:false}, no_junkopaque:{junkInStream:false,opaquePredicates:false}, minimal:{junkInStream:false,opaquePredicates:false,deadCodeInjection:false}};
(async()=>{
    const N=15;
    for(const [n,o] of Object.entries(cfgs)){
        let p=0; for(let i=0;i<N;i++) if(await trial(o)) p++;
        process.stdout.write(`${target} ${n.padEnd(16)} ${p}/${N}\n`);
    }
})();
