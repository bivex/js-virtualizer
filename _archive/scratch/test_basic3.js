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
    const tempDir = fs.mkdtempSync(path.join(__dirname, '..', 'output', 'basic3-'));
    const outPath = path.join(tempDir, 'test.out.js');
    await transpile(source, {
        fileName: "ilv-basic",
        vmOutputPath: path.join(tempDir, 'test.vm.js'),
        transpiledOutputPath: outPath,
        passes: ["RemoveUnused"],
        codeInterleaving: true
    });
    try {
        execSync(`node ${outPath}`, { encoding: 'utf-8', timeout: 10000 });
    } catch(e) {
        const lines = (e.stderr || '').split('\n');
        for (const l of lines.slice(0, 10)) {
            if (l.trim()) console.log(l);
        }
    }
}

run().catch(console.error);
