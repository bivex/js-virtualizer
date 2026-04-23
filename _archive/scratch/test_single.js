const { transpile } = require('../src/transpile');

const code = `
// @virtualize
function add(a, b) {
    return a + b;
}
console.log('Result:', add(10, 5));
`;

async function run() {
    try {
        console.log("Starting transpilation (no interleaving)...");
        const res = await transpile(code, {
            codeInterleaving: false,
            writeOutput: true,
            fileName: 'single-test',
            passes: [] 
        });
        console.log("Transpilation successful");
        
        // Try to run the transpiled code
        console.log("Running transpiled code...");
        const { execSync } = require('child_process');
        const output = execSync(`node ${res.transpiledOutputPath}`, { encoding: 'utf-8' });
        console.log("Output:", output);
    } catch (err) {
        console.error("Error during test:", err);
    }
}

run();
