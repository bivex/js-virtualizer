const { transpile } = require("./src/transpile");
const path = require("path");
const { execSync } = require("child_process");
const fs = require("fs");

async function run() {
    const source = `
        // @merge group1
        function add(a, b) {
            return a + b;
        }

        // @merge group1
        function sub(a, b) {
            return a - b;
        }

        const r1 = add(10, 5);
        const r2 = sub(10, 5);
        console.log("RESULT_ADD=" + r1);
        console.log("RESULT_SUB=" + r2);
    `;

    const outDir = path.join(__dirname, "output_verify");
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

    const vmPath = path.join(outDir, "verify.vm.js");
    const transPath = path.join(outDir, "verify.virtualized.js");

    console.log("Starting transpilation...");
    try {
        await transpile(source, {
            vmOutputPath: vmPath,
            transpiledOutputPath: transPath,
            writeOutput: true,
            controlFlowFlattening: true,
            polymorphic: true,
            deadCodeInjection: false,
            opaquePredicates: false,
            passes: new Set() // Skip obfuscation for faster verification
        });
        console.log("Transpilation finished.");

        console.log("Executing...");
        const output = execSync(`node ${transPath}`, { timeout: 5000 }).toString();
        console.log("Output:");
        console.log(output);

        if (output.includes("RESULT_ADD=15") && output.includes("RESULT_SUB=5")) {
            console.log("VERIFICATION SUCCESSFUL");
        } else {
            console.error("VERIFICATION FAILED: Unexpected output");
            process.exit(1);
        }
    } catch (e) {
        console.error("VERIFICATION FAILED with error:");
        console.error(e);
        process.exit(1);
    }
}

run();
