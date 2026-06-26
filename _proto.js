const {transpile} = require('/Volumes/External/Code/js-virtualizer/src/transpile');
const fs=require('fs');
const cp=require('child_process');
const code=fs.readFileSync('/Volumes/External/Code/js-virtualizer/sample/protos.js','utf-8');
const orig = cp.execSync(`node /Volumes/External/Code/js-virtualizer/sample/protos.js`).toString();
(async () => {
    for (let i=0;i<40;i++){
        const r = await transpile(code, {fileName:`p_${i}.js`, passes:['RemoveUnused'], junkInStream:false});
        let out, err='';
        try { out = cp.execSync(`node ${r.transpiledOutputPath}`, {stdio:['pipe','pipe','pipe']}).toString(); }
        catch(e){ out='CRASH'; err=(e.stderr||'').toString().split('\n').filter(l=>l.includes('Error')||l.includes('at JSVM')).slice(0,2).join(' | '); }
        if (out!==orig) console.log(`#${i} FAIL: ${out.slice(0,40)} :: ${err}`);
    }
    console.log('done');
})();
