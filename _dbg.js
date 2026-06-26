const {transpile} = require('/Volumes/External/Code/js-virtualizer/src/transpile');
const fs=require('fs'); const cp=require('child_process');
const code=fs.readFileSync('/Volumes/External/Code/js-virtualizer/sample/sequences.js','utf-8');
(async()=>{
    let hit=0, runs=0;
    for(let i=0;i<200;i++){
        runs++;
        try { await transpile(code,{fileName:`dbg_${i}.js`,passes:['RemoveUnused']}); }
        catch(e){ if(String(e.message||e).includes('OPAQUE_DEBUG')) { hit++; if(hit===1) console.log('FIRST HIT:', e.message); } else { console.log('OTHER ERR:', e.message); } }
        if(hit>=3) break;
    }
    console.log(`runs=${runs} opaque_unmapped_hits=${hit}`);
})();
