const {FunctionBytecodeGenerator} = require('/Volumes/External/Code/js-virtualizer/src/utils/BytecodeGenerator');
const acorn = require('acorn');
// Simulate: console.log("For in loop", k)
const code = `console.log("For in loop", k);`;
const body = acorn.parse(code, {ecmaVersion:'latest'}).body;
const g = new FunctionBytecodeGenerator(body, undefined, {registerCount:256, endian:'BE'});
g.declareVariable('console', g.randomRegister());
g.declareVariable('k', g.randomRegister());
// instrument getAvailableTempLoad to log
const orig = g.getAvailableTempLoad.bind(g);
let calls=[];
g.getAvailableTempLoad = function(){ const r=orig(); calls.push({tl:this.TLMap[r], reg:r}); return r; }
g.generate();
console.log('TL allocations during console.log("For in loop", k):');
calls.forEach((c,i)=>console.log('  #'+i, c.tl, 'reg', c.reg));
