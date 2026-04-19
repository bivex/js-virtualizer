const { transpile } = require('../src/transpile');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const source = `
// @virtualize
function add(a, b) { return a + b; }
// @virtualize
function sub(a, b) { return a - b; }
console.log(add(10, 5), sub(10, 5));
`;

async function run() {
    const tempDir = fs.mkdtempSync(path.join(__dirname, '..', 'output', 'basic-'));
    const outPath = path.join(tempDir, 'test.out.js');
    try {
        await transpile(source, {
            fileName: "ilv-basic",
            vmOutputPath: path.join(tempDir, 'test.vm.js'),
            transpiledOutputPath: outPath,
            passes: ["RemoveUnused"],
            codeInterleaving: true
        });
        const output = execSync(`node ${outPath}`, { encoding: 'utf-8', timeout: 10000 });
        console.log('Output:', output.trim());
    } catch(e) {
        const errLine = (e.stderr || '').split('\n').slice(0, 5).join('\n');
        console.log('Error:', errLine.substring(0, 500));
    }
}

run().catch(console.error);
