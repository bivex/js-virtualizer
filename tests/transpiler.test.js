/**
 * Copyright (c) 2026 Bivex
 *
 * Author: Bivex
 * Available for contact via email: support@b-b.top
 * For up-to-date contact information:
 * https://github.com/bivex
 *
 * Created: 2026-03-26 18:54
 * Last Updated: 2026-03-26 18:54
 *
 * Licensed under the MIT License.
 * Commercial licensing available upon request.
 */

const path = require("node:path");
const fs = require("node:fs");
const childProcess = require("node:child_process");

const {transpile} = require("../src/transpile");

const samplePath = path.join(__dirname, "../sample/");
const skip = new Set(["trycatch.js", "browserFingerprint.js"]);

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
