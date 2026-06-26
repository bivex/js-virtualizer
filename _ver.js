const {FunctionBytecodeGenerator} = require('/Volumes/External/Code/js-virtualizer/src/utils/BytecodeGenerator');
const acorn = require('acorn');
function seededRNG(s){let st=0x12345678;for(let i=0;i<s.length;i++)st=(st*1664525+s.charCodeAt(i))&0xFFFFFFFF;return ()=>{st=(st*1664525+1013904223)&0xFFFFFFFF;return st>>>0;};}
function buildScramble(rc){const start=3,end=rc-1;const idx=Array.from({length:end-start},(_,i)=>start+i);const rng=seededRNG('k');for(let i=idx.length-1;i>0;i--){const j=rng()%(i+1);[idx[i],idx[j]]=[idx[j],idx[i]];}const m=new Map();for(let i=0;i<end-start;i++)m.set(start+i,idx[i]);return m;}
const rc=256;
const sm=buildScramble(rc);
const rev=new Map(); for(const [l,p] of sm) rev.set(p,l);
const code=`let x=1; x=(x++,x); console.log(x); x=(2,3); console.log(x);`;
const body=acorn.parse(code,{ecmaVersion:'latest'}).body;
const g=new FunctionBytecodeGenerator(body,undefined,{registerCount:rc,cffStateRegister:rc-1,registerScrambleMap:sm,reverseScrambleMap:rev,endian:'BE'});
for(let r=1;r<=8;r++) g.reservedRegisters.add(rc-r);
g.declareVariable('console',g.randomRegister());
g.generate();
const physTL=g.getTempLoadRegisters();
const logTL=g.getLogicalTempLoadRegisters();
console.log('physical TL sample:', [...physTL].slice(0,5));
console.log('logical TL sample:', [...logTL].slice(0,5));
console.log('reserved (logical) sample:', [...g.reservedRegisters].slice(0,5));
console.log('Are logical TL disjoint from physical TL?', [...logTL].every(l=>!physTL.has(l)));
