const {FunctionBytecodeGenerator} = require('/Volumes/External/Code/js-virtualizer/src/utils/BytecodeGenerator');
const acorn = require('acorn');
const code = `let obj={a:1,b:2,c:3,d:4}; for(let k in obj){ }`;
const body = acorn.parse(code, {ecmaVersion:'latest'}).body;
const g = new FunctionBytecodeGenerator(body, undefined, {registerCount:256, endian:'BE'});
// console dependency
g.declareVariable('console', g.randomRegister());
g.generate();
let tlIn=0, tlOut=0;
const tlVals = new Set();
for(let i=1;i<=30;i++){ tlVals.add(g['TL'+i]); if(g.reservedRegisters.has(g['TL'+i])) tlIn++; else tlOut++; }
console.log('TL registers reserved after gen:', tlIn, '/30 ; NOT reserved:', tlOut);
console.log('reserved size:', g.reservedRegisters.size);
// Now simulate opaque scratch selection
const scratch=[];
for(let r=255;r>=0 && scratch.length<5;r--){ if(g.reservedRegisters.has(r)) continue; scratch.push(r); }
console.log('opaque scratch logical:', scratch);
console.log('scratch collides with a TL value?', scratch.some(r=>tlVals.has(r)));
