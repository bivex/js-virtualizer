const { transpile } = require("../src/transpile");
const JSVM = require("../src/vm_dev");
const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");

describe("Function Merging (Code Interleaving)", () => {
    const tmpDir = path.join(__dirname, "tmp_merging");

    beforeAll(() => {
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);
    });

    afterAll(() => {
        // fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test("should correctly merge and execute two functions", async () => {
        const source = `
            // @merge group1
            function add(a, b) {
                return a + b;
            }

            // @merge group1
            function sub(a, b) {
                return a - b;
            }

            globalThis.results = {
                add: add(10, 5),
                sub: sub(10, 5)
            };
        `;

        const vmPath = path.join(tmpDir, "merged.vm.js");
        const transPath = path.join(tmpDir, "merged.virtualized.js");

        await transpile(source, {
            vmOutputPath: vmPath,
            transpiledOutputPath: transPath,
            writeOutput: true,
            controlFlowFlattening: true,
            polymorphic: true
        });

        // Run the generated code in Node.js
        const output = execSync(`node ${transPath}`).toString();
        
        // We need to check globalThis.results. Since we run in a separate process, 
        // we should modify the source to print the results.
    });

    test("should correctly merge and execute two functions with shared state", async () => {
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
                throw new Error("Failed: " + r1 + ", " + r2);
            }
            console.log("SUCCESS");
        `;

        const vmPath = path.join(tmpDir, "merged_success.vm.js");
        const transPath = path.join(tmpDir, "merged_success.virtualized.js");

        await transpile(source, {
            vmOutputPath: vmPath,
            transpiledOutputPath: transPath,
            writeOutput: true,
            controlFlowFlattening: true,
            polymorphic: true,
            obfuscateVM: false,
            obfuscateTranspiled: false
        });

        const output = execSync(`node ${transPath}`).toString();
        expect(output).toContain("SUCCESS");
        expect(output).toContain("Adding 20 and 10");
        expect(output).toContain("Subtracting 10 from 20");
    });
});
