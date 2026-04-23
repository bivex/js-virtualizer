const { transpile } = require('../src/transpile');
const fs = require('fs');

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
    console.log("Starting...");
    try {
        const promise = transpile(code, {
            codeInterleaving: true,
            writeOutput: true,
            fileName: 'ilv-test-debug',
            passes: [] 
        });
        console.log("Promise created");
        const res = await promise;
        console.log("Done!");
    } catch (err) {
        console.error("Error:", err);
    }
}

run();
