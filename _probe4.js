const {FunctionBytecodeGenerator} = require('/Volumes/External/Code/js-virtualizer/src/utils/BytecodeGenerator');
const acorn = require('acorn');
const code = `console.log("For in loop", k);`;
const body = acorn.parse(code, {ecmaVersion:'latest'}).body;
const g = new FunctionBytecodeGenerator(body, undefined, {registerCount:256, endian:'BE'});
g.declareVariable('console', g.randomRegister());
g.declareVariable('k', g.randomRegister());
g.generate();
const ops = g.chunk.code.map(o => {
  const regs = [];
  // crude: read register operands from data bytes for common opcodes
  return o.name + '(' + (o.data ? Array.from(o.data.slice(0,Math.min(o.data.length,8))).join(',') : '') + ')';
});
console.log(ops.join('\n'));
