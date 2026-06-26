const {transpile} = require('/Volumes/External/Code/js-virtualizer/src/transpile');
const fs=require('fs');
const cp=require('child_process');
const code=fs.readFileSync('/Volumes/External/Code/js-virtualizer/sample/fakeasync.js','utf-8');
const orig = cp.execSync(`node /Volumes/External/Code/js-virtualizer/sample/fakeasync.js`).toString();
(async () => {
    let p=0,f=0;
    for (let i=0;i<6;i++){
        const r = await transpile(code, {fileName:`fa_${i}.js`, passes:['RemoveUnused']});
        let out,err='';
        try { out = cp.execSync(`node ${r.transpiledOutputPath}`, {stdio:['pipe','pipe','pipe'],timeout:15000}).toString(); }
        catch(e){ out='CRASH'; err=(e.stderr||e.message||'').toString().split('\n').filter(l=>l.includes('TypeError')||l.includes('Error:')).slice(0,1).join(''); }
        const ok = out===orig;
        if(ok) p++; else { f++; process.stdout.write(`#${i} FAIL ${out.slice(0,30).replace(/\n/g,'\\n')} ${err}\n`); }
    }
    process.stdout.write(`fakeasync ${p}/${p+f}\n`);
})();
