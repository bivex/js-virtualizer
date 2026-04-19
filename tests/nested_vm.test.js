/**
 * Copyright (c) 2026 Bivex
 *
 * Tests for the nested VM feature.
 * Verifies that critical opcode handlers (ADD, FUNC_CALL) are correctly
 * virtualized through an inner VM layer.
 */

const path = require("node:path");
const fs = require("node:fs");
const childProcess = require("node:child_process");

const {transpile} = require("../src/transpile");

const samplePath = path.join(__dirname, "../sample/");
const testFiles = ["sum.js", "branching.js", "patterns.js", "conditional.js", "switch.js"];

describe("nested VM", () => {
    test.each(testFiles)("nested VM transpiles %s with matching runtime output", async (file) => {
        const sampleCode = fs.readFileSync(path.join(samplePath, file), "utf-8");
        const result = await transpile(sampleCode, {
            fileName: `nested_${file}`,
            passes: ["RemoveUnused"],
            nestedVM: true
        });

        const originalOutput = childProcess.execSync(`node ${path.join(samplePath, file)}`).toString();
        const transpiledOutput = childProcess.execSync(`node -e "globalThis.__JSVM_DEBUG__=true; require('${result.transpiledOutputPath.replace(/\\/g, '/')}')"`).toString();

        expect(transpiledOutput).toBe(originalOutput);
    });

    test("nested VM produces VM output containing InnerVM class", async () => {
        const code = `
            // @virtualize
            function evaluate(a, b) {
                return a + b;
            }
            console.log(evaluate(3, 4));
        `;
        const result = await transpile(code, {
            fileName: "nested_class_check.js",
            passes: ["RemoveUnused"],
            nestedVM: true
        });

        expect(result.vm).toContain("InnerVM");
        expect(result.vm).toContain("InnerVM.programs");
    });

    test("nested VM output runs and produces correct result", async () => {
        const code = `
            // @virtualize
            function evaluate(x, y) {
                return x + y + x;
            }
            console.log(evaluate(5, 3));
        `;
        const result = await transpile(code, {
            fileName: "nested_arith.js",
            passes: ["RemoveUnused"],
            nestedVM: true
        });

        const transpiledOutput = childProcess.execSync(`node ${result.transpiledOutputPath}`).toString();
        expect(transpiledOutput.trim()).toBe("13");
    });

    test("nested VM handles function calls", async () => {
        const code = `
            function double(n) { return n * 2; }
            // @virtualize
            function evaluate() {
                return double(21);
            }
            console.log(evaluate());
        `;
        const result = await transpile(code, {
            fileName: "nested_call.js",
            passes: ["RemoveUnused"],
            nestedVM: true
        });

        const transpiledOutput = childProcess.execSync(`node ${result.transpiledOutputPath}`).toString();
        expect(transpiledOutput.trim()).toBe("42");
    });

    test("nested VM disabled (default) does not inject InnerVM", async () => {
        const code = `
            // @virtualize
            function evaluate(a, b) {
                return a + b;
            }
            console.log(evaluate(1, 2));
        `;
        const result = await transpile(code, {
            fileName: "nested_disabled.js",
            passes: ["RemoveUnused"],
            nestedVM: false
        });

        expect(result.vm).not.toContain("InnerVM");
    });
});
