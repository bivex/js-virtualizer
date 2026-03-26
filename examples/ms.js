/**
 * Copyright (c) 2026 Bivex
 *
 * Author: Bivex
 * Available for contact via email: support@b-b.top
 * For up-to-date contact information:
 * https://github.com/bivex
 *
 * Created: 2026-03-27 18:55
 * Last Updated: 2026-03-27 18:55
 *
 * Licensed under the MIT License.
 * Commercial licensing available upon request.
 */

const path = require("node:path");
const fs = require("node:fs");
const childProcess = require("node:child_process");

const {transpile} = require("../src/transpile");

const samplePath = path.join(__dirname, "../sample/ms.js");

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
        fileName: "ms-demo.js",
        vmOutputPath: path.join(__dirname, "../output/ms-demo.vm.js"),
        transpiledOutputPath: path.join(__dirname, "../output/ms-demo.virtualized.js"),
        passes: ["RemoveUnused", "ObfuscateVM", "ObfuscateTranspiled"]
    });

    const originalOutput = childProcess.execSync(`node ${samplePath}`).toString();
    const virtualizedOutput = childProcess.execSync(`node ${result.transpiledOutputPath}`).toString();

    console.log("Light library demo: ms");
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
