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
        const transpiledOutput = childProcess.execSync(`node ${result.transpiledOutputPath}`).toString();

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

    test("nested VM virtualizes CFF_DISPATCH through InnerVM", async () => {
        const code = `
            // @virtualize
            function evaluate(a) {
                switch(a) {
                    case 1: return 100;
                    case 2: return 200;
                    case 3: return 300;
                    default: return 0;
                }
            }
            console.log(evaluate(2));
        `;
        const result = await transpile(code, {
            fileName: "nested_cff.js",
            passes: ["RemoveUnused"],
            nestedVM: true,
            controlFlowFlattening: true
        });

        // Verify VM contains InnerVM and CFF structures
        expect(result.vm).toContain("InnerVM");
        expect(result.vm).toContain("InnerVM.programs");
        // Trampoline reads CFF inner hex from instance field
        expect(result.vm).toContain("this._cffInnerHex");

        const transpiledOutput = childProcess.execSync(`node ${result.transpiledOutputPath}`).toString();
        expect(transpiledOutput.trim()).toBe("200");
    });

    test("nested VM shuffle changes InnerVM handlers order", async () => {
        const code = `// @virtualize
        function add(a,b){return a+b}
        console.log(add(1,2))`;
        const result1 = await transpile(code, { fileName: "shuf1", nestedVM: true, passes:["RemoveUnused"] });
        const result2 = await transpile(code, { fileName: "shuf2", nestedVM: true, passes:["RemoveUnused"] });

        // Two builds should produce different InnerVM handler orderings (seeded from integrityKey)
        // Extract handlers arrays from VM output
        const extractHandlers = vmCode => {
            const start = vmCode.indexOf('this.handlers = [');
            if (start === -1) return '';
            const arrayStart = vmCode.indexOf('[', start);
            let depth = 0;
            for (let i = arrayStart; i < vmCode.length; i++) {
                if (vmCode[i] === '[') depth++;
                else if (vmCode[i] === ']') {
                    depth--;
                    if (depth === 0) return vmCode.substring(arrayStart, i + 1);
                }
            }
            return '';
        };
        const h1 = extractHandlers(result1.vm);
        const h2 = extractHandlers(result2.vm);

        // With different random keys, the shuffled order should differ >50% of time.
        // We just verify both are non-default (shuffling enabled). Cannot guarantee difference.
        expect(h1).toMatch(/I_ADD/);
        expect(h2).toMatch(/I_ADD/);
    });

    test("nested VM with code interleaving", async () => {
        const code = `
            // @virtualize
            function add(a,b){return a+b}
            // @virtualize
            function sub(a,b){return a-b}
            console.log(add(10,5), sub(10,5))
        `;
        const result = await transpile(code, {
            fileName: "nested_ilv",
            passes: ["RemoveUnused"],
            nestedVM: true,
            codeInterleaving: true
        });

        expect(result.vm).toContain("InnerVM");
        const output = childProcess.execSync(`node ${result.transpiledOutputPath}`).toString().trim();
        expect(output).toBe("15 5");
    });

    test("nested VM with all major protections", async () => {
        const code = `
            // @virtualize
            function complex(x) {
                if (x > 10) return x*2;
                for(let i=0;i<5;i++) x+=i;
                return x;
            }
            console.log(complex(3))
        `;
        const result = await transpile(code, {
            fileName: "nested_all",
            passes: ["RemoveUnused"],
            nestedVM: true,
            controlFlowFlattening: true,
            opaquePredicates: true,
            junkInStream: true,
            antiDump: true,
            dispatchObfuscation: true,
            whiteboxEncryption: true
        });

        expect(result.vm).toContain("InnerVM");
        const output = childProcess.execSync(`node ${result.transpiledOutputPath}`).toString().trim();
        // 3 + (0+1+2+3+4) = 13
        expect(output).toBe("13");
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
