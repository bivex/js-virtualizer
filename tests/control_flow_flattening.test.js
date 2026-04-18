const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");

const {transpile} = require("../src/transpile");
const {VMChunk, Opcode, encodeDWORD} = require("../src/utils/assembler");
const {applyControlFlowFlattening} = require("../src/utils/cff");

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

describe("control flow flattening", () => {
    test("CFF enabled produces correct output", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-cff-"));
        const vmOutputPath = path.join(tempDir, "cff.vm.js");
        const transpiledOutputPath = path.join(tempDir, "cff.virtualized.js");

        fs.writeFileSync(path.join(tempDir, "source.js"), simpleSource);

        await transpile(simpleSource, {
            fileName: "cff-basic",
            vmOutputPath,
            transpiledOutputPath,
            passes: ["RemoveUnused"],
            controlFlowFlattening: true
        });

        expect(runNodeScript(transpiledOutputPath).trim()).toBe("30");
    });

    test("CFF disabled produces correct output", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-nocff-"));
        const vmOutputPath = path.join(tempDir, "nocff.vm.js");
        const transpiledOutputPath = path.join(tempDir, "nocff.virtualized.js");

        fs.writeFileSync(path.join(tempDir, "source.js"), simpleSource);

        await transpile(simpleSource, {
            fileName: "nocff-basic",
            vmOutputPath,
            transpiledOutputPath,
            passes: ["RemoveUnused"],
            controlFlowFlattening: false
        });

        expect(runNodeScript(transpiledOutputPath).trim()).toBe("30");
    });

    test("CFF on and off produce same output", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-cffeq-"));
        const vm1 = path.join(tempDir, "on.vm.js");
        const app1 = path.join(tempDir, "on.virtualized.js");
        const vm2 = path.join(tempDir, "off.vm.js");
        const app2 = path.join(tempDir, "off.virtualized.js");

        fs.writeFileSync(path.join(tempDir, "source.js"), simpleSource);

        await transpile(simpleSource, {
            fileName: "cff-on",
            vmOutputPath: vm1,
            transpiledOutputPath: app1,
            passes: ["RemoveUnused"],
            controlFlowFlattening: true
        });

        await transpile(simpleSource, {
            fileName: "cff-off",
            vmOutputPath: vm2,
            transpiledOutputPath: app2,
            passes: ["RemoveUnused"],
            controlFlowFlattening: false
        });

        expect(runNodeScript(app1).trim()).toBe(runNodeScript(app2).trim());
    });

    test("CFF works with loops", async () => {
        const source = `
// @virtualize
function factorial(n) {
    let result = 1;
    for (let i = 2; i <= n; i++) {
        result *= i;
    }
    return result;
}

console.log(factorial(8));
`;
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-cff-loop-"));
        const vmOutputPath = path.join(tempDir, "loop.vm.js");
        const transpiledOutputPath = path.join(tempDir, "loop.virtualized.js");

        fs.writeFileSync(path.join(tempDir, "source.js"), source);

        await transpile(source, {
            fileName: "cff-loop",
            vmOutputPath,
            transpiledOutputPath,
            passes: ["RemoveUnused"],
            controlFlowFlattening: true
        });

        expect(runNodeScript(transpiledOutputPath).trim()).toBe("40320");
    });

    test("CFF works with while loops", async () => {
        const source = `
// @virtualize
function countdown(n) {
    let result = "";
    while (n > 0) {
        result += n;
        n--;
    }
    return result;
}

console.log(countdown(5));
`;
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-cff-while-"));
        const vmOutputPath = path.join(tempDir, "while.vm.js");
        const transpiledOutputPath = path.join(tempDir, "while.virtualized.js");

        fs.writeFileSync(path.join(tempDir, "source.js"), source);

        await transpile(source, {
            fileName: "cff-while",
            vmOutputPath,
            transpiledOutputPath,
            passes: ["RemoveUnused"],
            controlFlowFlattening: true
        });

        expect(runNodeScript(transpiledOutputPath).trim()).toBe("54321");
    });

    test("CFF works with nested conditionals", async () => {
        const source = `
// @virtualize
function fizzbuzz(n) {
    if (n % 15 === 0) return "FizzBuzz";
    if (n % 3 === 0) return "Fizz";
    if (n % 5 === 0) return "Buzz";
    return String(n);
}

console.log(fizzbuzz(15));
console.log(fizzbuzz(9));
console.log(fizzbuzz(10));
console.log(fizzbuzz(7));
`;
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-cff-cond-"));
        const vmOutputPath = path.join(tempDir, "cond.vm.js");
        const transpiledOutputPath = path.join(tempDir, "cond.virtualized.js");

        fs.writeFileSync(path.join(tempDir, "source.js"), source);

        await transpile(source, {
            fileName: "cff-cond",
            vmOutputPath,
            transpiledOutputPath,
            passes: ["RemoveUnused"],
            controlFlowFlattening: true
        });

        expect(runNodeScript(transpiledOutputPath).trim()).toBe("FizzBuzz\nFizz\nBuzz\n7");
    });

    test("CFF works with nested functions (fork)", async () => {
        const source = `
function apply(fn, v) { return fn(v); }

// @virtualize
function demo(x) {
    const neg = function(n) { return -n; };
    return apply(neg, x);
}

console.log(demo(42));
`;
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-cff-fork-"));
        const vmOutputPath = path.join(tempDir, "fork.vm.js");
        const transpiledOutputPath = path.join(tempDir, "fork.virtualized.js");

        fs.writeFileSync(path.join(tempDir, "source.js"), source);

        await transpile(source, {
            fileName: "cff-fork",
            vmOutputPath,
            transpiledOutputPath,
            passes: ["RemoveUnused"],
            controlFlowFlattening: true
        });

        expect(runNodeScript(transpiledOutputPath).trim()).toBe("-42");
    });

    test("CFF works with all protections combined", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-cff-all-"));
        const vmOutputPath = path.join(tempDir, "all.vm.js");
        const transpiledOutputPath = path.join(tempDir, "all.virtualized.js");

        fs.writeFileSync(path.join(tempDir, "source.js"), simpleSource);

        await transpile(simpleSource, {
            fileName: "cff-all",
            vmOutputPath,
            transpiledOutputPath,
            passes: ["RemoveUnused"],
            controlFlowFlattening: true,
            opaquePredicates: true,
            selfModifyingBytecode: true,
            deadCodeInjection: true,
            memoryProtection: true,
            polymorphic: true
        });

        expect(runNodeScript(transpiledOutputPath).trim()).toBe("30");
    });

    test("CFF with polyEndian LE produces correct output", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-cff-le-"));
        const vmOutputPath = path.join(tempDir, "le.vm.js");
        const transpiledOutputPath = path.join(tempDir, "le.virtualized.js");

        fs.writeFileSync(path.join(tempDir, "source.js"), simpleSource);

        await transpile(simpleSource, {
            fileName: "cff-le",
            vmOutputPath,
            transpiledOutputPath,
            passes: ["RemoveUnused"],
            controlFlowFlattening: true,
            polymorphic: true
        });

        expect(runNodeScript(transpiledOutputPath).trim()).toBe("30");
    });

    test("5 consecutive CFF builds all produce correct output", async () => {
        for (let i = 0; i < 5; i++) {
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `jsvm-cff-multi${i}-`));
            const vmOutputPath = path.join(tempDir, "multi.vm.js");
            const transpiledOutputPath = path.join(tempDir, "multi.virtualized.js");

            await transpile(simpleSource, {
                fileName: `cff-multi-${i}`,
                vmOutputPath,
                transpiledOutputPath,
                passes: ["RemoveUnused"],
                controlFlowFlattening: true
            });

            expect(runNodeScript(transpiledOutputPath).trim()).toBe("30");
        }
    });

    test("applyControlFlowFlattening skips chunks with fewer than 4 opcodes", () => {
        const chunk = new VMChunk();
        chunk.append(new Opcode("LOAD_DWORD", 3, encodeDWORD(1)));
        chunk.append(new Opcode("END"));

        const original = chunk.toBytes();
        const result = applyControlFlowFlattening(chunk, 255);

        expect(result.initialStateId).toBe(0);
        expect(Buffer.compare(original, chunk.toBytes())).toBe(0);
    });

    test("applyControlFlowFlattening skips chunks with unsafe opcodes", () => {
        const chunk = new VMChunk();
        chunk.append(new Opcode("LOAD_DWORD", 3, encodeDWORD(10)));
        chunk.append(new Opcode("LOAD_DWORD", 4, encodeDWORD(20)));
        chunk.append(new Opcode("ADD", 5, 3, 4));
        chunk.append(new Opcode("TRY_CATCH_FINALLY", Buffer.alloc(9)));
        chunk.append(new Opcode("END"));

        const result = applyControlFlowFlattening(chunk, 255);
        expect(result.initialStateId).toBe(0);
    });

    test("applyControlFlowFlattening adds CFF_DISPATCH opcode to chunk", () => {
        const chunk = new VMChunk();
        // Need enough opcodes and block structure
        chunk.append(new Opcode("LOAD_DWORD", 3, encodeDWORD(0)));
        chunk.append(new Opcode("LOAD_BOOL", 4, 1));
        chunk.append(new Opcode("JUMP_EQ", 4, encodeDWORD(14)));
        chunk.append(new Opcode("LOAD_DWORD", 5, encodeDWORD(99)));
        chunk.append(new Opcode("END"));
        chunk.append(new Opcode("LOAD_DWORD", 5, encodeDWORD(42)));
        chunk.append(new Opcode("END"));

        const result = applyControlFlowFlattening(chunk, 255);

        if (result.chunk) {
            const hasDispatch = result.chunk.code.some(op => op.name === "CFF_DISPATCH");
            expect(hasDispatch).toBe(true);
        }
    });

    test("CFF works with switch statements", async () => {
        const source = `
// @virtualize
function dayType(day) {
    switch (day) {
        case 0: return "weekend";
        case 6: return "weekend";
        default: return "weekday";
    }
}

console.log(dayType(0));
console.log(dayType(3));
console.log(dayType(6));
`;
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-cff-switch-"));
        const vmOutputPath = path.join(tempDir, "switch.vm.js");
        const transpiledOutputPath = path.join(tempDir, "switch.virtualized.js");

        fs.writeFileSync(path.join(tempDir, "source.js"), source);

        await transpile(source, {
            fileName: "cff-switch",
            vmOutputPath,
            transpiledOutputPath,
            passes: ["RemoveUnused"],
            controlFlowFlattening: true
        });

        expect(runNodeScript(transpiledOutputPath).trim()).toBe("weekend\nweekday\nweekend");
    });

    test("CFF works with string operations", async () => {
        const source = `
// @virtualize
function repeat(s, n) {
    let result = "";
    for (let i = 0; i < n; i++) {
        result += s;
    }
    return result;
}

console.log(repeat("ab", 4));
`;
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-cff-str-"));
        const vmOutputPath = path.join(tempDir, "str.vm.js");
        const transpiledOutputPath = path.join(tempDir, "str.virtualized.js");

        fs.writeFileSync(path.join(tempDir, "source.js"), source);

        await transpile(source, {
            fileName: "cff-str",
            vmOutputPath,
            transpiledOutputPath,
            passes: ["RemoveUnused"],
            controlFlowFlattening: true
        });

        expect(runNodeScript(transpiledOutputPath).trim()).toBe("abababab");
    });

    test("CFF produces correct output for complex fibonacci", async () => {
        const source = `
// @virtualize
function fib(n) {
    if (n <= 1) return n;
    let a = 0, b = 1;
    for (let i = 2; i <= n; i++) {
        const t = a + b;
        a = b;
        b = t;
    }
    return b;
}

console.log(fib(15));
`;
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-cff-fib-"));
        const vmOutputPath = path.join(tempDir, "fib.vm.js");
        const transpiledOutputPath = path.join(tempDir, "fib.virtualized.js");

        fs.writeFileSync(path.join(tempDir, "source.js"), source);

        await transpile(source, {
            fileName: "cff-fib",
            vmOutputPath,
            transpiledOutputPath,
            passes: ["RemoveUnused"],
            controlFlowFlattening: true
        });

        expect(runNodeScript(transpiledOutputPath).trim()).toBe("610");
    });
});
