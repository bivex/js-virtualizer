const fs = require('fs');
const path = require('path');

function traceRequire(modulePath) {
    const start = Date.now();
    console.log(`Loading ${modulePath}...`);
    const mod = require(modulePath);
    console.log(`Loaded ${modulePath} in ${Date.now() - start}ms`);
    return mod;
}

console.log("Starting diagnostic...");
traceRequire('acorn');
traceRequire('acorn-walk');
traceRequire('@babel/core');
traceRequire('eslint-scope');
traceRequire('escodegen');
traceRequire('javascript-obfuscator');
console.log("Done diagnostic.");
