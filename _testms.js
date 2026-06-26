const {transpile} = require('/Volumes/External/Code/js-virtualizer/src/transpile');
const fs=require('fs');
const cp=require('child_process');
const code=fs.readFileSync('/Volumes/External/Code/js-virtualizer/sample/ms.js','utf-8');

async function run(label, opts) {
    const r = await transpile(code, Object.assign({fileName:`ms_${label}.js`, passes:['RemoveUnused']}, opts));
    let out;
    try { out = cp.execSync(`node ${r.transpiledOutputPath}`, {stdio:['pipe','pipe','pipe']}).toString(); }
    catch(e) { out = 'ERROR: ' + (e.stderr||e.message).toString().split('\n')[0]; }
    const orig = cp.execSync(`node /Volumes/External/Code/js-virtualizer/sample/ms.js`).toString();
    console.log(label.padEnd(15), out === orig ? 'PASS' : 'FAIL');
}
(async () => {
    await run('baseline', {});
    await run('no_opaque', {opaquePredicates:false});
    await run('no_cff', {controlFlowFlattening:false});
    await run('no_deadcode', {deadCodeInjection:false});
    await run('no_junk', {junkInStream:false});
    await run('no_poly', {polymorphic:false});
    await run('no_smb', {selfModifyingBytecode:false});
    await run('minimal', {opaquePredicates:false,controlFlowFlattening:false,deadCodeInjection:false,junkInStream:false});
})();
