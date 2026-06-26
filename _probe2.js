const {FunctionBytecodeGenerator} = require('/Volumes/External/Code/js-virtualizer/src/utils/BytecodeGenerator');
const acorn = require('acorn');
// more complex body to stress temp load reuse
const code = `
let obj={a:1,b:2,c:3,d:4};
for(let k in obj){ }
for(let j=0;j<3;j++){ }
let x = obj.a + obj.b;
`;
const body = acorn.parse(code, {ecmaVersion:'latest'}).body;
const g = new FunctionBytecodeGenerator(body, undefined, {registerCount:256, endian:'BE'});
g.declareVariable('console', g.randomRegister());
g.generate();
let tlIn=0, tlOut=0; const tlVals=[];
for(let i=1;i<=30;i++){ tlVals.push(g['TL'+i]); if(g.reservedRegisters.has(g['TL'+i])) tlIn++; else {tlOut++; console.log('  TL'+i+'='+g['TL'+i]+' NOT reserved');} }
console.log('TL reserved:', tlIn, '/30 unreserved:', tlOut);
