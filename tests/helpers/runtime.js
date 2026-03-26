const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const childProcess = require("node:child_process");

const {transpile} = require("../../src/transpile");

const outputDir = path.join(__dirname, "../../output");

function runNodeScript(filePath) {
    return childProcess.execFileSync("node", [filePath]).toString();
}

async function transpileAndRun(code, label, transpileOptions = {}) {
    fs.mkdirSync(outputDir, {recursive: true});

    const slug = `${label}-${crypto.randomBytes(4).toString("hex")}`;
    const inputPath = path.join(outputDir, `${slug}.source.js`);
    const vmOutputPath = path.join(outputDir, `${slug}.vm.js`);
    const transpiledOutputPath = path.join(outputDir, `${slug}.virtualized.js`);

    fs.writeFileSync(inputPath, code);

    const result = await transpile(code, {
        fileName: `${slug}.js`,
        vmOutputPath,
        transpiledOutputPath,
        passes: ["RemoveUnused"],
        ...transpileOptions
    });

    return {
        result,
        inputPath,
        originalOutput: runNodeScript(inputPath),
        virtualizedOutput: runNodeScript(result.transpiledOutputPath)
    };
}

module.exports = {
    transpileAndRun,
    runNodeScript
};
