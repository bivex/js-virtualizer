const { transpile } = require("./src/transpile");
const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");

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

    const tmpDir = path.join(__dirname, "tmp_manual");
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);

    const vmPath = path.join(tmpDir, "manual.vm.js");
    const transPath = path.join(tmpDir, "manual.virtualized.js");

    console.log("Transpiling...");
    await transpile(source, {
        vmOutputPath: vmPath,
        transpiledOutputPath: transPath,
        writeOutput: true,
        controlFlowFlattening: true,
        polymorphic: true,
        obfuscateVM: false,
        obfuscateTranspiled: false,
        passes: new Set()
    });

    console.log("Executing...");
    try {
        const output = execSync(`node ${transPath}`, { stdio: 'inherit', timeout: 10000 });
    } catch (e) {
        console.log("Exec failed with status: " + e.status);
    }
}

run();
