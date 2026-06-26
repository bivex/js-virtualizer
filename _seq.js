const {transpile} = require('/Volumes/External/Code/js-virtualizer/src/transpile');
const fs=require('fs'); const cp=require('child_process');
const code=fs.readFileSync('/Volumes/External/Code/js-virtualizer/sample/sequences.js','utf-8');
const orig=cp.execSync(`node /Volumes/External/Code/js-virtualizer/sample/sequences.js`).toString();
(async()=>{
    for(let i=0;i<300;i++){
        const r=await transpile(code,{fileName:`sq_${i}.js`,passes:['RemoveUnused']});
        let out;
        try{out=cp.execSync(`node ${r.transpiledOutputPath}`,{stdio:['pipe','pipe','pipe'],timeout:15000}).toString();}
        catch(e){out='CRASH: '+(e.stderr||'').toString().split('\n').filter(l=>l.includes('TypeError')||l.includes('at JSVM')).slice(0,1).join('');}
        if(out!==orig){
            console.log('FAIL run#'+i);
            const o=orig.split('\n'),u=out.split('\n');
            for(let k=0;k<Math.max(o.length,u.length);k++){ if(o[k]!==u[k]){ console.log(' line',k,'exp',JSON.stringify(o[k]),'got',JSON.stringify(u[k])); break;} }
            console.log('PATH:', r.transpiledOutputPath);
            process.exit(0);
        }
    }
    console.log('no failure in 300');
})();
