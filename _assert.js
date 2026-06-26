const {FunctionBytecodeGenerator} = require('/Volumes/External/Code/js-virtualizer/src/utils/BytecodeGenerator');
const {transpile} = require('/Volumes/External/Code/js-virtualizer/src/transpile');
const fs=require('fs');
const code=fs.readFileSync('/Volumes/External/Code/js-virtualizer/sample/sequences.js','utf-8');
// hook generate to capture
let gen;
const orig=FunctionBytecodeGenerator.prototype.generate;
FunctionBytecodeGenerator.prototype.generate=function(...a){ gen=this; return orig.apply(this,a); };
(async()=>{
    let collisions=0, runs=0;
    for(let i=0;i<100;i++){
        await transpile(code,{fileName:`as_${i}.js`,passes:['RemoveUnused']});
        runs++;
        if(gen && gen.opaqueScratch){
            const physTL=gen.getTempLoadRegisters();
            // physical reserved:
            const physLive=new Set();
            // can't easily get scrambleMap here; check scratch vs physical TL only
            for(const s of gen.opaqueScratch){ if(physTL.has(s)){ collisions++; console.log('COLLIDE scratch',s,'in physical TL'); break; } }
        }
    }
    console.log(`runs=${runs} scratch-in-physical-TL collisions=${collisions}`);
})();
