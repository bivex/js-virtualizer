const { transpile } = require("./src/transpile");
const path = require("path");
const { execSync } = require("child_process");
const fs = require("fs");

async function run() {
    const source = `
        // @virtualize
        function add(a, b) {
            console.log("Adding " + a + " and " + b);
            return a + b;
        }

        const r = add(5, 3);
        if (r !== 8) {
            console.log("Failed: r=" + r);
            process.exit(1);
        }
        console.log("SUCCESS");
    `;

    const outDir = path.join(__dirname, "output_simple");
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

    const vmPath = path.join(outDir, "simple.vm.js");
    const transPath = path.join(outDir, "simple.virtualized.js");

    await transpile(source, {
        vmOutputPath: vmPath,
        transpiledOutputPath: transPath,
        writeOutput: true,
        controlFlowFlattening: false,
        passes: new Set()
    });

    execSync(`node ${transPath}`, { stdio: 'inherit', timeout: 5000 });
}

run();
