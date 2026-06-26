const {transpile} = require('/Volumes/External/Code/js-virtualizer/src/transpile');
const fs=require('fs');
const cp=require('child_process');
const code=fs.readFileSync('/Volumes/External/Code/js-virtualizer/sample/loops.js','utf-8');
const orig = cp.execSync(`node /Volumes/External/Code/js-virtualizer/sample/loops.js`).toString();
(async () => {
    for (let i=0;i<200;i++){
        const r = await transpile(code, {fileName:`cr_${i}.js`, passes:['RemoveUnused']});
        let out;
        try { out = cp.execSync(`node ${r.transpiledOutputPath}`, {stdio:['pipe','pipe','pipe'],timeout:15000}).toString(); }
        catch(e){ out='CRASH'; }
        if (out!==orig && out==='CRASH') { console.log('CRASH at run', i, 'path:', r.transpiledOutputPath); process.exit(0); }
        if (out!==orig) { console.log('CORRUPT at run', i, 'path:', r.transpiledOutputPath); process.exit(0); }
    }
    console.log('no crash in 200 runs');
})();
