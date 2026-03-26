const path = require("node:path");
const fs = require("node:fs");
const childProcess = require("node:child_process");

const {transpile} = require("../src/transpile");

const samplePath = path.join(__dirname, "../sample/");
const skip = new Set(["trycatch.js"]);

describe("transpiler", () => {
    const sampleFiles = fs.readdirSync(samplePath).filter((file) => !skip.has(file));

    test.each(sampleFiles)("transpiles %s with matching runtime output", async (file) => {
        const sampleCode = fs.readFileSync(path.join(samplePath, file), "utf-8");
        const result = await transpile(sampleCode, {
            fileName: file,
            passes: ["RemoveUnused"]
        });

        const originalOutput = childProcess.execSync(`node ${path.join(samplePath, file)}`).toString();
        const transpiledOutput = childProcess.execSync(`node ${result.transpiledOutputPath}`).toString();

        expect(transpiledOutput).toBe(originalOutput);
    });
});
