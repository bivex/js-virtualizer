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
    const tempDir = fs.mkdtempSync(path.join(__dirname, '..', 'output', 'basic2-'));
    const outPath = path.join(tempDir, 'test.out.js');
    await transpile(source, {
        fileName: "ilv-basic",
        vmOutputPath: path.join(tempDir, 'test.vm.js'),
        transpiledOutputPath: outPath,
        passes: ["RemoveUnused"],
        codeInterleaving: true
    });
    try {
        const output = execSync(`node ${outPath}`, { encoding: 'utf-8', timeout: 10000, stdio: 'pipe' });
        console.log('Output:', output.trim());
    } catch(e) {
        console.log('stderr:', (e.stderr || '').substring(0, 800));
    }
}

run().catch(console.error);
