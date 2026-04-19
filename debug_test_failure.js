const { transpile } = require("./src/transpile");
const path = require("path");
const { execSync } = require("child_process");
const fs = require("fs");

async function run() {
    const source = `
        // @merge group1
        function add(a, b) {
            console.log("Adding " + a + " and " + b);
            return a + b;
        }

        // @merge group1
        function sub(a, b) {
            console.log("Subtracting " + b + " from " + a);
            return a - b;
        }

        const r1 = add(20, 10);
        const r2 = sub(20, 10);
        if (r1 !== 30 || r2 !== 10) {
            console.log("Failed values: r1=" + r1 + ", r2=" + r2);
            process.exit(1);
        }
        console.log("SUCCESS");
    `;

    const outDir = path.join(__dirname, "output_debug");
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

    const vmPath = path.join(outDir, "debug_no_cff.vm.js");
    const transPath = path.join(outDir, "debug_no_cff.virtualized.js");

    await transpile(source, {
        vmOutputPath: vmPath,
        transpiledOutputPath: transPath,
        writeOutput: true,
        controlFlowFlattening: true,
        polymorphic: false,
        obfuscateVM: false,
        obfuscateTranspiled: false,
        passes: new Set()
    });

    try {
        const output = execSync(`node ${transPath}`, { stdio: 'inherit', timeout: 5000 });
    } catch (e) {
        console.log("Exec failed with status: " + e.status);
    }
}

run();
