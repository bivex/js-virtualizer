const {transpile} = require('/Volumes/External/Code/js-virtualizer/src/transpile');
const fs=require('fs');
const cp=require('child_process');
const target = process.argv[2] || 'loops.js';
const orig = cp.execSync(`node /Volumes/External/Code/js-virtualizer/sample/${target}`).toString();
(async () => {
    for (let i=0;i<60;i++){
        const r = await transpile(fs.readFileSync(`/Volumes/External/Code/js-virtualizer/sample/${target}`,'utf-8'), {fileName:`flk_${i}.js`, passes:['RemoveUnused']});
        let out,err='';
        try { out = cp.execSync(`node ${r.transpiledOutputPath}`, {stdio:['pipe','pipe','pipe'],timeout:15000}).toString(); }
        catch(e){ out='CRASH'; err=(e.stderr||e.message||'').toString().split('\n').filter(l=>l.includes('TypeError')||l.includes('at JSVM')||l.includes('Error:')).slice(0,2).join(' | '); }
        if (out!==orig) {
            process.stdout.write(`#${i} FAIL\n--- got ---\n${out.slice(0,200)}\n--- err ---\n${err}\n=========\n`);
            break;
        }
    }
    process.stdout.write('scan done\n');
})();
