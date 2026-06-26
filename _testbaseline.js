const {transpile} = require('/Volumes/External/Code/js-virtualizer/src/transpile');
const fs=require('fs');
const cp=require('child_process');
const code=fs.readFileSync('/Volumes/External/Code/js-virtualizer/sample/ms.js','utf-8');
const orig = cp.execSync(`node /Volumes/External/Code/js-virtualizer/sample/ms.js`).toString();
(async () => {
    let pass=0, fail=0;
    for (let i=0; i<30; i++) {
        const r = await transpile(code, {fileName:`ms_b${i}.js`, passes:['RemoveUnused']});
        let out;
        try { out = cp.execSync(`node ${r.transpiledOutputPath}`, {stdio:['pipe','pipe','pipe']}).toString(); }
        catch(e) { out = 'ERROR'; }
        if (out===orig) pass++; else fail++;
    }
    console.log(`BASELINE: pass=${pass} fail=${fail}`);
})();
