const {FunctionBytecodeGenerator} = require('/Volumes/External/Code/js-virtualizer/src/utils/BytecodeGenerator');
const {transpile} = require('/Volumes/External/Code/js-virtualizer/src/transpile');
const fs=require('fs');
const code=fs.readFileSync('/Volumes/External/Code/js-virtualizer/sample/sequences.js','utf-8');
const acorn=require('acorn');
// Monkeypatch the generator to record TL and reserved after generate
const origGen = FunctionBytecodeGenerator.prototype.generate;
let captured=null;
FunctionBytecodeGenerator.prototype.generate = function(...a){ const r=origGen.apply(this,a); captured={tl:this.getTempLoadRegisters(), reserved:new Set(this.reservedRegisters), output:this.outputRegister}; return r; };
(async()=>{
    // Reproduce sq_10 by transpiling; we can't get the exact seed but check if 233 is ever TL/reserved
    let reg233tl=0, reg233res=0, runs=0;
    for(let i=0;i<50;i++){
        await transpile(code,{fileName:`dmp_${i}.js`,passes:['RemoveUnused'], opaquePredicates:false, junkInStream:false, deadCodeInjection:false});
        if(captured){ runs++; if(captured.tl.has(233)) reg233tl++; if(captured.reserved.has(233)) reg233res++; }
    }
    console.log(`runs=${runs} reg233 in TL=${reg233tl} in reserved=${reg233res}`);
})();
