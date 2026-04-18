const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");

const {transpile} = require("../src/transpile");
const {VMChunk, Opcode, encodeDWORD} = require("../src/utils/assembler");
const {insertOpaquePredicates} = require("../src/utils/opaquePredicates");

function runNodeScript(filePath) {
    return childProcess.execFileSync("node", [filePath]).toString();
}

const simpleSource = `
// @virtualize
function add(a, b) {
    return a + b;
}

console.log(add(10, 20));
`;

describe("opaque predicates", () => {
    test("opaquePredicates: true produces correct output", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-opq-"));
        const vmOutputPath = path.join(tempDir, "opq.vm.js");
        const transpiledOutputPath = path.join(tempDir, "opq.virtualized.js");

        fs.writeFileSync(path.join(tempDir, "source.js"), simpleSource);

        await transpile(simpleSource, {
            fileName: "opq-basic",
            vmOutputPath,
            transpiledOutputPath,
            passes: ["RemoveUnused"],
            opaquePredicates: true
        });

        const output = runNodeScript(transpiledOutputPath).trim();
        expect(output).toBe("30");
    });

    test("opaquePredicates: false produces correct output", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-noopq-"));
        const vmOutputPath = path.join(tempDir, "noopq.vm.js");
        const transpiledOutputPath = path.join(tempDir, "noopq.virtualized.js");

        fs.writeFileSync(path.join(tempDir, "source.js"), simpleSource);

        await transpile(simpleSource, {
            fileName: "noopq-basic",
            vmOutputPath,
            transpiledOutputPath,
            passes: ["RemoveUnused"],
            opaquePredicates: false
        });

        const output = runNodeScript(transpiledOutputPath).trim();
        expect(output).toBe("30");
    });

    test("on and off produce same output", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-opqeq-"));
        const vm1 = path.join(tempDir, "on.vm.js");
        const app1 = path.join(tempDir, "on.virtualized.js");
        const vm2 = path.join(tempDir, "off.vm.js");
        const app2 = path.join(tempDir, "off.virtualized.js");

        fs.writeFileSync(path.join(tempDir, "source.js"), simpleSource);

        await transpile(simpleSource, {
            fileName: "opq-on",
            vmOutputPath: vm1,
            transpiledOutputPath: app1,
            passes: ["RemoveUnused"],
            opaquePredicates: true
        });

        await transpile(simpleSource, {
            fileName: "opq-off",
            vmOutputPath: vm2,
            transpiledOutputPath: app2,
            passes: ["RemoveUnused"],
            opaquePredicates: false
        });

        expect(runNodeScript(app1).trim()).toBe(runNodeScript(app2).trim());
    });

    test("opaque predicates increase bytecode size", async () => {
        const on = await transpile(simpleSource, {
            fileName: "opq-size-on",
            writeOutput: false,
            passes: ["RemoveUnused"],
            opaquePredicates: true
        });

        const off = await transpile(simpleSource, {
            fileName: "opq-size-off",
            writeOutput: false,
            passes: ["RemoveUnused"],
            opaquePredicates: false
        });

        // Transpiled code with opaque predicates should be larger
        expect(on.transpiled.length).toBeGreaterThan(off.transpiled.length);
    });

    test("works with loops", async () => {
        const source = `
// @virtualize
function sum(n) {
    let total = 0;
    for (let i = 1; i <= n; i++) total += i;
    return total;
}

console.log(sum(100));
`;
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-opq-loop-"));
        const vmOutputPath = path.join(tempDir, "loop.vm.js");
        const transpiledOutputPath = path.join(tempDir, "loop.virtualized.js");

        fs.writeFileSync(path.join(tempDir, "source.js"), source);

        await transpile(source, {
            fileName: "opq-loop",
            vmOutputPath,
            transpiledOutputPath,
            passes: ["RemoveUnused"],
            opaquePredicates: true
        });

        expect(runNodeScript(transpiledOutputPath).trim()).toBe("5050");
    });

    test("works with branching", async () => {
        const source = `
// @virtualize
function classify(n) {
    if (n > 0) return "pos";
    if (n < 0) return "neg";
    return "zero";
}

console.log(classify(5));
console.log(classify(-1));
console.log(classify(0));
`;
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-opq-branch-"));
        const vmOutputPath = path.join(tempDir, "branch.vm.js");
        const transpiledOutputPath = path.join(tempDir, "branch.virtualized.js");

        fs.writeFileSync(path.join(tempDir, "source.js"), source);

        await transpile(source, {
            fileName: "opq-branch",
            vmOutputPath,
            transpiledOutputPath,
            passes: ["RemoveUnused"],
            opaquePredicates: true
        });

        expect(runNodeScript(transpiledOutputPath).trim()).toBe("pos\nneg\nzero");
    });

    test("works with nested functions", async () => {
        const source = `
function apply(fn, v) { return fn(v); }

// @virtualize
function demo(x) {
    const square = function(n) { return n * n; };
    return apply(square, x);
}

console.log(demo(7));
`;
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-opq-fork-"));
        const vmOutputPath = path.join(tempDir, "fork.vm.js");
        const transpiledOutputPath = path.join(tempDir, "fork.virtualized.js");

        fs.writeFileSync(path.join(tempDir, "source.js"), source);

        await transpile(source, {
            fileName: "opq-fork",
            vmOutputPath,
            transpiledOutputPath,
            passes: ["RemoveUnused"],
            opaquePredicates: true
        });

        expect(runNodeScript(transpiledOutputPath).trim()).toBe("49");
    });

    test("works with try/catch", async () => {
        const source = `
// @virtualize
function safe(fn) {
    try { return fn(); }
    catch (e) { return e.message; }
}

console.log(safe(() => { throw new Error("err"); }));
`;
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-opq-try-"));
        const vmOutputPath = path.join(tempDir, "try.vm.js");
        const transpiledOutputPath = path.join(tempDir, "try.virtualized.js");

        fs.writeFileSync(path.join(tempDir, "source.js"), source);

        await transpile(source, {
            fileName: "opq-try",
            vmOutputPath,
            transpiledOutputPath,
            passes: ["RemoveUnused"],
            opaquePredicates: true
        });

        expect(runNodeScript(transpiledOutputPath).trim()).toBe("err");
    });

    test("works with all protections combined", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-opq-all-"));
        const vmOutputPath = path.join(tempDir, "all.vm.js");
        const transpiledOutputPath = path.join(tempDir, "all.virtualized.js");

        fs.writeFileSync(path.join(tempDir, "source.js"), simpleSource);

        await transpile(simpleSource, {
            fileName: "opq-all",
            vmOutputPath,
            transpiledOutputPath,
            passes: ["RemoveUnused"],
            opaquePredicates: true,
            controlFlowFlattening: true,
            selfModifyingBytecode: true,
            deadCodeInjection: true,
            memoryProtection: true,
            polymorphic: true
        });

        expect(runNodeScript(transpiledOutputPath).trim()).toBe("30");
    });

    test("5 consecutive builds all produce correct output", async () => {
        for (let i = 0; i < 5; i++) {
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `jsvm-opq-multi${i}-`));
            const vmOutputPath = path.join(tempDir, "multi.vm.js");
            const transpiledOutputPath = path.join(tempDir, "multi.virtualized.js");

            await transpile(simpleSource, {
                fileName: `opq-multi-${i}`,
                vmOutputPath,
                transpiledOutputPath,
                passes: ["RemoveUnused"],
                opaquePredicates: true
            });

            expect(runNodeScript(transpiledOutputPath).trim()).toBe("30");
        }
    });

    test("insertOpaquePredicates returns chunk unchanged with null scratch", () => {
        const chunk = new VMChunk();
        chunk.append(new Opcode("LOAD_DWORD", 3, encodeDWORD(42)));
        chunk.append(new Opcode("END"));

        const original = chunk.toBytes();
        insertOpaquePredicates(chunk, null);
        const after = chunk.toBytes();

        expect(Buffer.compare(original, after)).toBe(0);
    });

    test("insertOpaquePredicates returns chunk unchanged with empty scratch", () => {
        const chunk = new VMChunk();
        chunk.append(new Opcode("LOAD_DWORD", 3, encodeDWORD(42)));
        chunk.append(new Opcode("END"));

        const original = chunk.toBytes();
        insertOpaquePredicates(chunk, []);
        const after = chunk.toBytes();

        expect(Buffer.compare(original, after)).toBe(0);
    });

    test("insertOpaquePredicates adds opcodes to chunk with enough density", () => {
        const chunk = new VMChunk();
        // Need enough non-special opcodes to exceed the density threshold
        for (let i = 0; i < 20; i++) {
            chunk.append(new Opcode("LOAD_DWORD", 3, encodeDWORD(i)));
        }
        chunk.append(new Opcode("END"));

        const originalLength = chunk.code.length;
        const opaqueScratch = [10, 11, 12, 13, 14];

        insertOpaquePredicates(chunk, opaqueScratch, 64, { density: 3 });

        expect(chunk.code.length).toBeGreaterThan(originalLength);
    });

    test("insertOpaquePredicates preserves END opcode", () => {
        const chunk = new VMChunk();
        chunk.append(new Opcode("LOAD_DWORD", 3, encodeDWORD(42)));
        chunk.append(new Opcode("END"));

        insertOpaquePredicates(chunk, [10, 11, 12, 13, 14], 64);

        const hasEnd = chunk.code.some(op => op.name === "END");
        expect(hasEnd).toBe(true);
    });

    test("opaque predicates work with string concatenation", async () => {
        const source = `
// @virtualize
function greet(name) {
    return "Hello, " + name + "!";
}

console.log(greet("Test"));
`;
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-opq-str-"));
        const vmOutputPath = path.join(tempDir, "str.vm.js");
        const transpiledOutputPath = path.join(tempDir, "str.virtualized.js");

        fs.writeFileSync(path.join(tempDir, "source.js"), source);

        await transpile(source, {
            fileName: "opq-str",
            vmOutputPath,
            transpiledOutputPath,
            passes: ["RemoveUnused"],
            opaquePredicates: true
        });

        expect(runNodeScript(transpiledOutputPath).trim()).toBe("Hello, Test!");
    });

    test("opaque predicates work with arithmetic expressions", async () => {
        const source = `
// @virtualize
function calc(a, b, c) {
    return (a + b) * c - a / b;
}

console.log(calc(10, 5, 3));
`;
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-opq-arith-"));
        const vmOutputPath = path.join(tempDir, "arith.vm.js");
        const transpiledOutputPath = path.join(tempDir, "arith.virtualized.js");

        fs.writeFileSync(path.join(tempDir, "source.js"), source);

        await transpile(source, {
            fileName: "opq-arith",
            vmOutputPath,
            transpiledOutputPath,
            passes: ["RemoveUnused"],
            opaquePredicates: true
        });

        const output = runNodeScript(transpiledOutputPath).trim();
        expect(output).toBe("43");
    });
});
