const Module = require('module');
const origReq = Module.prototype.require;
const path = require('path');
// intercept to instrument
const {transpile} = require('/Volumes/External/Code/js-virtualizer/src/transpile');
const CE = require('/Volumes/External/Code/js-virtualizer/src/transformations/CallExpression');
const fs=require('fs');
const cp=require('child_process');
let collisions=[];
const orig = CE;
// Wrap resolveCallExpression
const wrapped = function(node, awaited){
    const before = {};
    for(let i=1;i<=30;i++){ before[this['TL'+i]] = this.available['TL'+i]; }
    const result = orig.call(this, node, awaited);
    // The callee register and argsRegister(=result) must not have been reallocated
    return result;
};
// Can't easily rebind since transpile binds once. Instead instrument getAvailableTempLoad globally.
const BG = require('/Volumes/External/Code/js-virtualizer/src/utils/BytecodeGenerator').FunctionBytecodeGenerator;
const origGATL = BG.prototype.getAvailableTempLoad;
const allocLog = [];
BG.prototype.getAvailableTempLoad = function(){
    const r = origGATL.call(this);
    return r;
};
const code=fs.readFileSync('/Volumes/External/Code/js-virtualizer/sample/loops.js','utf-8');
(async()=>{
    // Just transpile many times; can't detect collision easily without deeper hooks.
    console.log('instrumentation scaffold only');
})();
