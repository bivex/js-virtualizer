const {transpile} = require('/Volumes/External/Code/js-virtualizer/src/transpile');
const fs=require('fs');
const cp=require('child_process');
const code=fs.readFileSync('/Volumes/External/Code/js-virtualizer/sample/ms.js','utf-8');
const orig = cp.execSync(`node /Volumes/External/Code/js-virtualizer/sample/ms.js`).toString().trim();

(async () => {
    for (let i = 0; i < 50; i++) {
        const r = await transpile(code, {fileName:`ms_d${i}.js`, passes:['RemoveUnused']});
        let out;
        try { 
            out = cp.execSync(`node ${r.transpiledOutputPath}`, {stdio:['pipe','pipe','pipe']}).toString().trim();
        } catch(e) { out = 'ERROR'; }
        if (out !== orig) {
            console.log(`FAIL run ${i}: expected="${orig.slice(0,60)}" got="${out.slice(0,60)}"`);
        }
    }
    console.log('Done');
})();
