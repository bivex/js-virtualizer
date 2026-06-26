const {transpile} = require('/Volumes/External/Code/js-virtualizer/src/transpile');
const fs=require('fs'); const cp=require('child_process');
const code=fs.readFileSync('/Volumes/External/Code/js-virtualizer/sample/sequences.js','utf-8');
const opq = require('/Volumes/External/Code/js-virtualizer/src/utils/opaquePredicates');
const orig = opq.insertOpaquePredicates;
opq.insertOpaquePredicates = function(chunk, scratch, rc, opts={}){
    const before = chunk.code.map((o,i)=>i+':'+o.name);
    const r = orig.call(this, chunk, scratch, rc, opts);
    // find VFUNC_SETUP_CALLBACK and print region around it
    const after = r.code.map((o,i)=>i+':'+o.name);
    const vidx = after.findIndex(s=>s.includes('VFUNC_SETUP_CALLBACK'));
    console.error('=== vfunc context (indices) ===');
    for(let i=Math.max(0,vidx-25);i<=Math.min(after.length-1,vidx+2);i++) console.error(after[i]);
    return r;
};
(async()=>{
    // need to reproduce cap_10 — just transpile once with same opts and hope
    await transpile(code,{fileName:'opqdbg.js',passes:['RemoveUnused'],opaquePredicates:true,junkInStream:false,deadCodeInjection:false,controlFlowFlattening:false,selfModifyingBytecode:false,antiDump:false,timeLock:false,dispatchObfuscation:false,polymorphic:false,whiteboxEncryption:false});
})();
