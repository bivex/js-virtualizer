const {transpile} = require('/Volumes/External/Code/js-virtualizer/src/transpile');
const fs=require('fs');
const cp=require('child_process');
const target = process.argv[2];
const orig=cp.execSync(`node /Volumes/External/Code/js-virtualizer/sample/${target}`).toString();
async function trial(opts){
    const r = await transpile(fs.readFileSync(`/Volumes/External/Code/js-virtualizer/sample/${target}`,'utf-8'),Object.assign({fileName:`y_${Math.random().toString(36).slice(2,6)}.js`,passes:['RemoveUnused']},opts));
    try{return cp.execSync(`node ${r.transpiledOutputPath}`,{stdio:['pipe','pipe','pipe'],timeout:15000}).toString()===orig;}catch(e){return false;}
}
const full={};
const cfgs={
  full:{},
  full_nocff:{controlFlowFlattening:false},
  full_noopaque:{opaquePredicates:false},
  full_nojunk:{junkInStream:false},
  full_nodeadcode:{deadCodeInjection:false},
  full_nocff_noopaque:{controlFlowFlattening:false,opaquePredicates:false},
  full_nocff_nojunk:{controlFlowFlattening:false,junkInStream:false},
};
(async()=>{
  const N=18;
  for(const [n,o] of Object.entries(cfgs)){
    let p=0; for(let i=0;i<N;i++) if(await trial(o)) p++;
    process.stdout.write(`${target} ${n.padEnd(20)} ${p}/${N}\n`);
  }
})();
