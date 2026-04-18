const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");
const crypto = require("crypto");

const {transpile} = require("../src/transpile");

function runNodeScript(filePath) {
    return childProcess.execFileSync("node", [filePath]).toString();
}

function extractEmbeddedVmProfile(source) {
    const match = source.match(/new __JSV_RUNTIME\((\{[\s\S]*?\})\)/);
    if (!match) {
        throw new Error("Failed to extract embedded VM profile");
    }
    return Function(`return (${match[1]});`)();
}

const simpleSource = `
// @virtualize
function poly(a, b) {
    return a + b;
}

console.log(poly(3, 4));
`;

const complexSource = `
// @virtualize
function fibonacci(n) {
    if (n <= 1) return n;
    let a = 0, b = 1;
    for (let i = 2; i <= n; i++) {
        const tmp = a + b;
        a = b;
        b = tmp;
    }
    return b;
}

console.log(fibonacci(10));
`;

describe("polymorphic VM", () => {
    test("polymorphic: true produces correct output", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-poly-"));
        const vmOutputPath = path.join(tempDir, "poly.vm.js");
        const transpiledOutputPath = path.join(tempDir, "poly.virtualized.js");

        fs.writeFileSync(path.join(tempDir, "source.js"), simpleSource);

        await transpile(simpleSource, {
            fileName: "poly-basic",
            vmOutputPath,
            transpiledOutputPath,
            passes: ["RemoveUnused"],
            polymorphic: true
        });

        const output = runNodeScript(transpiledOutputPath).trim();
        expect(output).toBe("7");
    });

    test("polymorphic: false produces correct output", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-nopoly-"));
        const vmOutputPath = path.join(tempDir, "nopoly.vm.js");
        const transpiledOutputPath = path.join(tempDir, "nopoly.virtualized.js");

        fs.writeFileSync(path.join(tempDir, "source.js"), simpleSource);

        await transpile(simpleSource, {
            fileName: "nopoly-basic",
            vmOutputPath,
            transpiledOutputPath,
            passes: ["RemoveUnused"],
            polymorphic: false
        });

        const output = runNodeScript(transpiledOutputPath).trim();
        expect(output).toBe("7");
    });

    test("poly and non-poly produce same output", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-polyeq-"));
        const vmPath1 = path.join(tempDir, "eq1.vm.js");
        const appPath1 = path.join(tempDir, "eq1.virtualized.js");
        const vmPath2 = path.join(tempDir, "eq2.vm.js");
        const appPath2 = path.join(tempDir, "eq2.virtualized.js");

        await transpile(simpleSource, {
            fileName: "eq-poly",
            vmOutputPath: vmPath1,
            transpiledOutputPath: appPath1,
            passes: ["RemoveUnused"],
            polymorphic: true
        });

        await transpile(simpleSource, {
            fileName: "eq-nopoly",
            vmOutputPath: vmPath2,
            transpiledOutputPath: appPath2,
            passes: ["RemoveUnused"],
            polymorphic: false
        });

        const out1 = runNodeScript(appPath1).trim();
        const out2 = runNodeScript(appPath2).trim();
        expect(out1).toBe(out2);
    });

    test("polyEndian is BE or LE when polymorphic: true", async () => {
        const result = await transpile(simpleSource, {
            fileName: "poly-endian",
            writeOutput: false,
            passes: ["RemoveUnused"],
            polymorphic: true
        });

        const profile = extractEmbeddedVmProfile(result.transpiled);
        expect(["BE", "LE"]).toContain(profile.polyEndian);
    });

    test("polyEndian is always BE when polymorphic: false", async () => {
        const result = await transpile(simpleSource, {
            fileName: "nopoly-endian",
            writeOutput: false,
            passes: ["RemoveUnused"],
            polymorphic: false
        });

        const profile = extractEmbeddedVmProfile(result.transpiled);
        expect(profile.polyEndian).toBe("BE");
    });

    test("different transpile runs produce different profile IDs", async () => {
        const r1 = await transpile(simpleSource, {
            fileName: "poly-diff1",
            writeOutput: false,
            passes: ["RemoveUnused"],
            polymorphic: true
        });
        const r2 = await transpile(simpleSource, {
            fileName: "poly-diff2",
            writeOutput: false,
            passes: ["RemoveUnused"],
            polymorphic: true
        });

        const p1 = extractEmbeddedVmProfile(r1.transpiled);
        const p2 = extractEmbeddedVmProfile(r2.transpiled);
        expect(p1.profileId).not.toBe(p2.profileId);
    });

    test("different transpile runs produce different VM code", async () => {
        const r1 = await transpile(simpleSource, {
            fileName: "poly-vm1",
            writeOutput: false,
            passes: ["RemoveUnused"],
            polymorphic: true
        });
        const r2 = await transpile(simpleSource, {
            fileName: "poly-vm2",
            writeOutput: false,
            passes: ["RemoveUnused"],
            polymorphic: true
        });

        expect(r1.vm).not.toBe(r2.vm);
        const h1 = crypto.createHash("sha256").update(r1.transpiled).digest("hex");
        const h2 = crypto.createHash("sha256").update(r2.transpiled).digest("hex");
        expect(h1).not.toBe(h2);
    });

    test("register count varies across builds", async () => {
        const registerCounts = new Set();
        for (let i = 0; i < 5; i++) {
            const r = await transpile(simpleSource, {
                fileName: `poly-reg-${i}`,
                writeOutput: false,
                passes: ["RemoveUnused"],
                polymorphic: true
            });
            const profile = extractEmbeddedVmProfile(r.transpiled);
            registerCounts.add(profile.registerCount);
        }
        // With 5 random builds, we should get at least 2 different register counts
        expect(registerCounts.size).toBeGreaterThanOrEqual(2);
    });

    test("dispatcher variant varies across builds", async () => {
        const variants = new Set();
        for (let i = 0; i < 5; i++) {
            const r = await transpile(simpleSource, {
                fileName: `poly-disp-${i}`,
                writeOutput: false,
                passes: ["RemoveUnused"],
                polymorphic: true
            });
            const profile = extractEmbeddedVmProfile(r.transpiled);
            variants.add(profile.dispatcherVariant);
        }
        expect(variants.size).toBeGreaterThanOrEqual(2);
    });

    test("polymorphic works with loops", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-poly-loop-"));
        const vmOutputPath = path.join(tempDir, "loop.vm.js");
        const transpiledOutputPath = path.join(tempDir, "loop.virtualized.js");

        fs.writeFileSync(path.join(tempDir, "source.js"), complexSource);

        await transpile(complexSource, {
            fileName: "poly-loop",
            vmOutputPath,
            transpiledOutputPath,
            passes: ["RemoveUnused"],
            polymorphic: true
        });

        const output = runNodeScript(transpiledOutputPath).trim();
        expect(output).toBe("55");
    });

    test("polymorphic works with branching", async () => {
        const source = `
// @virtualize
function classify(n) {
    if (n > 0) return "positive";
    if (n < 0) return "negative";
    return "zero";
}

console.log(classify(5));
console.log(classify(-3));
console.log(classify(0));
`;
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-poly-branch-"));
        const vmOutputPath = path.join(tempDir, "branch.vm.js");
        const transpiledOutputPath = path.join(tempDir, "branch.virtualized.js");

        fs.writeFileSync(path.join(tempDir, "source.js"), source);

        await transpile(source, {
            fileName: "poly-branch",
            vmOutputPath,
            transpiledOutputPath,
            passes: ["RemoveUnused"],
            polymorphic: true
        });

        const output = runNodeScript(transpiledOutputPath).trim();
        expect(output).toBe("positive\nnegative\nzero");
    });

    test("polymorphic works with nested functions (fork)", async () => {
        const source = `
function apply(fn, val) {
    return fn(val);
}

// @virtualize
function demo(input) {
    const double = function(x) { return x * 2; };
    return apply(double, input);
}

console.log(demo(21));
`;
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-poly-fork-"));
        const vmOutputPath = path.join(tempDir, "fork.vm.js");
        const transpiledOutputPath = path.join(tempDir, "fork.virtualized.js");

        fs.writeFileSync(path.join(tempDir, "source.js"), source);

        await transpile(source, {
            fileName: "poly-fork",
            vmOutputPath,
            transpiledOutputPath,
            passes: ["RemoveUnused"],
            polymorphic: true
        });

        const output = runNodeScript(transpiledOutputPath).trim();
        expect(output).toBe("42");
    });

    test("polymorphic works with string operations", async () => {
        const source = `
// @virtualize
function greet(name) {
    return "Hello, " + name + "!";
}

console.log(greet("World"));
`;
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-poly-str-"));
        const vmOutputPath = path.join(tempDir, "str.vm.js");
        const transpiledOutputPath = path.join(tempDir, "str.virtualized.js");

        fs.writeFileSync(path.join(tempDir, "source.js"), source);

        await transpile(source, {
            fileName: "poly-str",
            vmOutputPath,
            transpiledOutputPath,
            passes: ["RemoveUnused"],
            polymorphic: true
        });

        const output = runNodeScript(transpiledOutputPath).trim();
        expect(output).toBe("Hello, World!");
    });

    test("polymorphic works with try/catch", async () => {
        const source = `
// @virtualize
function safeDivide(a, b) {
    try {
        if (b === 0) throw new Error("division by zero");
        return a / b;
    } catch (e) {
        return e.message;
    }
}

console.log(safeDivide(10, 2));
console.log(safeDivide(10, 0));
`;
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-poly-try-"));
        const vmOutputPath = path.join(tempDir, "try.vm.js");
        const transpiledOutputPath = path.join(tempDir, "try.virtualized.js");

        fs.writeFileSync(path.join(tempDir, "source.js"), source);

        await transpile(source, {
            fileName: "poly-try",
            vmOutputPath,
            transpiledOutputPath,
            passes: ["RemoveUnused"],
            polymorphic: true
        });

        const output = runNodeScript(transpiledOutputPath).trim();
        expect(output).toBe("5\ndivision by zero");
    });

    test("polymorphic works with CFF enabled", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-poly-cff-"));
        const vmOutputPath = path.join(tempDir, "cff.vm.js");
        const transpiledOutputPath = path.join(tempDir, "cff.virtualized.js");

        fs.writeFileSync(path.join(tempDir, "source.js"), complexSource);

        await transpile(complexSource, {
            fileName: "poly-cff",
            vmOutputPath,
            transpiledOutputPath,
            passes: ["RemoveUnused"],
            polymorphic: true,
            controlFlowFlattening: true
        });

        const output = runNodeScript(transpiledOutputPath).trim();
        expect(output).toBe("55");
    });

    test("polymorphic works with opaque predicates", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-poly-opaque-"));
        const vmOutputPath = path.join(tempDir, "opaque.vm.js");
        const transpiledOutputPath = path.join(tempDir, "opaque.virtualized.js");

        fs.writeFileSync(path.join(tempDir, "source.js"), simpleSource);

        await transpile(simpleSource, {
            fileName: "poly-opaque",
            vmOutputPath,
            transpiledOutputPath,
            passes: ["RemoveUnused"],
            polymorphic: true,
            opaquePredicates: true
        });

        const output = runNodeScript(transpiledOutputPath).trim();
        expect(output).toBe("7");
    });

    test("polymorphic works with all protections enabled simultaneously", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-poly-all-"));
        const vmOutputPath = path.join(tempDir, "all.vm.js");
        const transpiledOutputPath = path.join(tempDir, "all.virtualized.js");

        fs.writeFileSync(path.join(tempDir, "source.js"), complexSource);

        await transpile(complexSource, {
            fileName: "poly-all",
            vmOutputPath,
            transpiledOutputPath,
            passes: ["RemoveUnused"],
            polymorphic: true,
            controlFlowFlattening: true,
            opaquePredicates: true,
            selfModifyingBytecode: true,
            deadCodeInjection: true,
            memoryProtection: true
        });

        const output = runNodeScript(transpiledOutputPath).trim();
        expect(output).toBe("55");
    });

    test("polymorphic produces hardened profile (clustered or striped)", async () => {
        const r = await transpile(simpleSource, {
            fileName: "poly-hardened",
            writeOutput: false,
            passes: ["RemoveUnused"],
            polymorphic: true
        });

        const profile = extractEmbeddedVmProfile(r.transpiled);
        expect(["clustered", "striped"]).toContain(profile.dispatcherVariant);
    });

    test("polymorphic register count meets hardened minimum (>=192)", async () => {
        const r = await transpile(simpleSource, {
            fileName: "poly-minreg",
            writeOutput: false,
            passes: ["RemoveUnused"],
            polymorphic: true
        });

        const profile = extractEmbeddedVmProfile(r.transpiled);
        expect(profile.registerCount).toBeGreaterThanOrEqual(192);
    });

    test("polymorphic runs 5 builds of same source, all correct", async () => {
        for (let i = 0; i < 5; i++) {
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `jsvm-poly-multi${i}-`));
            const vmOutputPath = path.join(tempDir, "multi.vm.js");
            const transpiledOutputPath = path.join(tempDir, "multi.virtualized.js");

            await transpile(simpleSource, {
                fileName: `poly-multi-${i}`,
                vmOutputPath,
                transpiledOutputPath,
                passes: ["RemoveUnused"],
                polymorphic: true
            });

            const output = runNodeScript(transpiledOutputPath).trim();
            expect(output).toBe("7");
        }
    });

    test("polymorphic with explicit vmProfile still applies polyEndian", async () => {
        const r = await transpile(simpleSource, {
            fileName: "poly-explicit",
            writeOutput: false,
            passes: ["RemoveUnused"],
            polymorphic: true,
            vmProfile: {
                profileId: "explicit-test",
                registerCount: 192,
                dispatcherVariant: "clustered"
            }
        });

        const profile = extractEmbeddedVmProfile(r.transpiled);
        expect(["BE", "LE"]).toContain(profile.polyEndian);
        expect(profile.registerCount).toBe(192);
    });
});
