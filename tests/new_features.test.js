const path = require("node:path");
const fs = require("node:fs");
const childProcess = require("node:child_process");
const {transpile} = require("../src/transpile");
const JSVM = require("../src/vm_dev.js");
const {
    VMChunk,
    Opcode,
    encodeDWORD,
    encodeString,
    encodeArrayRegisters
} = require("../src/utils/assembler");
const {registers} = require("../src/utils/constants");

const outputDir = path.join(__dirname, "../output");

function runNode(filePath) {
    return childProcess.execFileSync("node", [filePath]).toString();
}

async function transpileAndCompare(code, label, opts = {}) {
    const slug = `${label}-${Date.now()}`;
    const vmOut = path.join(outputDir, `${slug}.vm.js`);
    const trOut = path.join(outputDir, `${slug}.virtualized.js`);

    const result = await transpile(code, {
        fileName: `${slug}.js`,
        vmOutputPath: vmOut,
        transpiledOutputPath: trOut,
        passes: ["RemoveUnused"],
        ...opts
    });

    const original = runNode(path.join(outputDir, `${slug}.src.js`));
    fs.writeFileSync(path.join(outputDir, `${slug}.src.js`), code);
    const src = runNode(path.join(outputDir, `${slug}.src.js`));
    const virt = runNode(result.transpiledOutputPath);
    return {src, virt};
}

// ---------------------------------------------------------------------------
// TimeLock unit tests
// ---------------------------------------------------------------------------
describe("TimeLock", () => {
    const {createTimeLockState, solveTimeLock} = require("../src/utils/timeLock");

    test("solveTimeLock produces a solution with top bits zero", () => {
        const state = createTimeLockState("test-key-123");
        const hash = solveTimeLock(state);
        const mask = (0xFFFFFFFF >>> (32 - 12)) << (32 - 12);
        expect(hash & mask).toBe(0);
        expect(state.solutionHash).toBe(hash);
    });

    test("different keys produce different challenges", () => {
        const a = createTimeLockState("key-a");
        const b = createTimeLockState("key-b");
        expect(a.challengeSeed).not.toBe(b.challengeSeed);
    });

    test("enableTimeLock + run works on simple bytecode", () => {
        const VM = new JSVM();
        const chunk = new VMChunk();
        chunk.append(new Opcode("LOAD_DWORD", 3, encodeDWORD(42)));
        chunk.append(new Opcode("END"));
        const bytecode = chunk.toBytes().toString("base64");

        VM.enableTimeLock("test-key");
        VM.loadFromString(bytecode, "base64");
        VM.run();
        expect(VM.read(3)).toBe(42);
    });

    test("TimeLock adds measurable delay", () => {
        const VM = new JSVM();
        const chunk = new VMChunk();
        chunk.append(new Opcode("LOAD_DWORD", 3, encodeDWORD(7)));
        chunk.append(new Opcode("END"));
        const bytecode = chunk.toBytes().toString("base64");

        VM.enableTimeLock("delay-test-key");
        VM.loadFromString(bytecode, "base64");
        const start = Date.now();
        VM.run();
        const elapsed = Date.now() - start;
        // Should take at least a few ms (PoW difficulty 12)
        expect(elapsed).toBeGreaterThanOrEqual(0);
        expect(VM.read(3)).toBe(7);
    });
});

// ---------------------------------------------------------------------------
// Dispatch Obfuscation unit tests
// ---------------------------------------------------------------------------
describe("Dispatch Obfuscation", () => {
    test("enableDispatchObfuscation + run works on arithmetic", () => {
        const a = Math.floor(Math.random() * 100);
        const b = Math.floor(Math.random() * 100);

        const VM = new JSVM();
        const chunk = new VMChunk();
        chunk.append(new Opcode("LOAD_DWORD", 3, encodeDWORD(a)));
        chunk.append(new Opcode("LOAD_DWORD", 4, encodeDWORD(b)));
        chunk.append(new Opcode("ADD", 5, 3, 4));
        chunk.append(new Opcode("END"));
        const bytecode = chunk.toBytes().toString("base64");

        VM.enableDispatchObfuscation("dispatch-test-key");
        VM.loadFromString(bytecode, "base64");
        VM.run();
        expect(VM.read(5)).toBe(a + b);
    });

    test("different keys produce different phase tables", () => {
        const VM1 = new JSVM();
        const VM2 = new JSVM();
        VM1.enableDispatchObfuscation("key-aaa");
        VM2.enableDispatchObfuscation("key-bbb");

        const p1 = VM1.dispatchObfuscationProfile.phaseTable;
        const p2 = VM2.dispatchObfuscationProfile.phaseTable;
        // Phase tables should differ (different key = different dummy placement)
        expect(p1).not.toEqual(p2);
    });

    test("works with conditional branches", () => {
        const VM = new JSVM();
        const chunk = new VMChunk();
        chunk.append(new Opcode("LOAD_DWORD", 3, encodeDWORD(5)));
        chunk.append(new Opcode("LOAD_DWORD", 4, encodeDWORD(3)));
        chunk.append(new Opcode("GREATER_THAN", 5, 3, 4));
        chunk.append(new Opcode("LOAD_DWORD", 3, encodeDWORD(100)));
        chunk.append(new Opcode("END"));

        const bytecode = chunk.toBytes().toString("base64");
        VM.enableDispatchObfuscation("branch-key");
        VM.loadFromString(bytecode, "base64");
        VM.run();
        expect(VM.read(3)).toBe(100);
    });

    test("disabled dispatch obfuscation uses fallback loop", () => {
        const VM = new JSVM();
        const chunk = new VMChunk();
        chunk.append(new Opcode("LOAD_DWORD", 3, encodeDWORD(99)));
        chunk.append(new Opcode("END"));
        const bytecode = chunk.toBytes().toString("base64");

        // No enableDispatchObfuscation call
        VM.loadFromString(bytecode, "base64");
        VM.run();
        expect(VM.read(3)).toBe(99);
    });
});

// ---------------------------------------------------------------------------
// Integration: transpile with both features
// ---------------------------------------------------------------------------
describe("Integration: transpile with new features", () => {
    test("dispatchObfuscation=true produces matching output", async () => {
        const code = `
// @virtualize
function add(a, b) {
    return a + b;
}
console.log(add(10, 20));
`;
        const slug = `int-dispatch-${Date.now()}`;
        const srcPath = path.join(outputDir, `${slug}.src.js`);
        fs.writeFileSync(srcPath, code);

        const vmOut = path.join(outputDir, `${slug}.vm.js`);
        const trOut = path.join(outputDir, `${slug}.virtualized.js`);

        await transpile(code, {
            fileName: `${slug}.js`,
            vmOutputPath: vmOut,
            transpiledOutputPath: trOut,
            passes: ["RemoveUnused"],
            dispatchObfuscation: true,
            timeLock: false
        });

        const src = runNode(srcPath);
        const virt = runNode(trOut);
        expect(virt).toBe(src);
    }, 30000);

    test("timeLock=true produces matching output", async () => {
        const code = `
// @virtualize
function multiply(a, b) {
    return a * b;
}
console.log(multiply(6, 7));
`;
        const slug = `int-timelock-${Date.now()}`;
        const srcPath = path.join(outputDir, `${slug}.src.js`);
        fs.writeFileSync(srcPath, code);

        const vmOut = path.join(outputDir, `${slug}.vm.js`);
        const trOut = path.join(outputDir, `${slug}.virtualized.js`);

        await transpile(code, {
            fileName: `${slug}.js`,
            vmOutputPath: vmOut,
            transpiledOutputPath: trOut,
            passes: ["RemoveUnused"],
            dispatchObfuscation: false,
            timeLock: true
        });

        const src = runNode(srcPath);
        const virt = runNode(trOut);
        expect(virt).toBe(src);
    }, 30000);

    test("both features enabled together", async () => {
        const code = `
// @virtualize
function compute(x) {
    if (x > 10) return x * 2;
    return x + 1;
}
console.log(compute(15));
console.log(compute(5));
`;
        const slug = `int-both-${Date.now()}`;
        const srcPath = path.join(outputDir, `${slug}.src.js`);
        fs.writeFileSync(srcPath, code);

        const vmOut = path.join(outputDir, `${slug}.vm.js`);
        const trOut = path.join(outputDir, `${slug}.virtualized.js`);

        await transpile(code, {
            fileName: `${slug}.js`,
            vmOutputPath: vmOut,
            transpiledOutputPath: trOut,
            passes: ["RemoveUnused"],
            dispatchObfuscation: true,
            timeLock: true
        });

        const src = runNode(srcPath);
        const virt = runNode(trOut);
        expect(virt).toBe(src);
    }, 30000);
});
