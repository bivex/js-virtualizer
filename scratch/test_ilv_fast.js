const { transpile } = require('../src/transpile');
const fs = require('fs');
const path = require('path');

const code = `
// @virtualize
function add(a, b) {
    return a + b;
}
// @virtualize
function sub(a, b) {
    return a - b;
}
console.log('Result:', add(10, 5), sub(10, 5));
`;

async function run() {
    try {
        console.log("Starting transpilation (no obfuscation)...");
        const res = await transpile(code, {
            codeInterleaving: true,
            writeOutput: true,
            fileName: 'ilv-test-fast',
            passes: [] // Disable obfuscation for speed
        });
        console.log("Transpilation successful");
        console.log("Transpiled output saved to:", res.transpiledOutputPath);
        
        // Try to run the transpiled code
        console.log("Running transpiled code...");
        const { execSync } = require('child_process');
        const output = execSync(`node ${res.transpiledOutputPath}`, { encoding: 'utf-8' });
        console.log("Output from transpiled code:");
        console.log(output);
        
        if (output.includes('Result: 15 5')) {
            console.log("SUCCESS: Interleaving works!");
        } else {
            console.log("FAILURE: Output does not match expected result.");
        }
    } catch (err) {
        console.error("Error during test:", err);
    }
}

run();
