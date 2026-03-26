const path = require("node:path");
const fs = require("node:fs");
const childProcess = require("node:child_process");

const {transpile} = require("../src/transpile");

const samplePath = path.join(__dirname, "../sample/fingerprint.js");

function previewBlock(title, value, maxLength = 800) {
    console.log(`\n=== ${title} ===`);
    if (value.length <= maxLength) {
        console.log(value);
        return;
    }
    console.log(`${value.slice(0, maxLength)}\n... [truncated ${value.length - maxLength} chars]`);
}

async function main() {
    const sampleCode = fs.readFileSync(samplePath, "utf-8");
    const result = await transpile(sampleCode, {
        fileName: "fingerprint-demo.js",
        vmOutputPath: path.join(__dirname, "../output/fingerprint-demo.vm.js"),
        transpiledOutputPath: path.join(__dirname, "../output/fingerprint-demo.virtualized.js"),
        passes: ["RemoveUnused", "ObfuscateVM", "ObfuscateTranspiled"]
    });

    const originalOutput = childProcess.execSync(`node ${samplePath}`).toString();
    const virtualizedOutput = childProcess.execSync(`node ${result.transpiledOutputPath}`).toString();

    console.log(`Sample: ${samplePath}`);
    console.log(`VM output: ${result.vmOutputPath}`);
    console.log(`Virtualized output: ${result.transpiledOutputPath}`);
    console.log(`Original output matches virtualized: ${originalOutput === virtualizedOutput}`);

    previewBlock("Original runtime output", originalOutput.trim());
    previewBlock("Virtualized runtime output", virtualizedOutput.trim());
    previewBlock("Virtualized JS preview", result.transpiled);
    previewBlock("VM preview", result.vm);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
