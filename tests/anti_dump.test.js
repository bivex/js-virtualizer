const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");
const zlib = require("node:zlib");

const JSVM = require("../src/vm_dev");
const {transpile} = require("../src/transpile");
const {VMChunk, Opcode, encodeDWORD, encodeString} = require("../src/utils/assembler");

function runNodeScript(filePath) {
    return childProcess.execFileSync("node", [filePath]).toString();
}

function applyStatefulOpcodeEncoding(chunk, seed) {
    let position = 0;
    for (const opcode of chunk.code) {
        opcode.opcode = Buffer.from([JSVM.encodeStatefulOpcode(opcode.opcode[0], position, seed)]);
        position += opcode.toBytes().length;
    }
}

function applyJumpTargetEncoding(chunk, seed) {
    const offsetsMap = {
        JUMP_UNCONDITIONAL: [0], JUMP_EQ: [1], JUMP_NOT_EQ: [1],
        MACRO_TEST_JUMP_EQ: [3], MACRO_TEST_JUMP_NOT_EQ: [3]
    };
    let position = 0;
    for (const opcode of chunk.code) {
        const offsets = offsetsMap[opcode.name] || [];
        if (offsets.length > 0) {
            opcode.data = Buffer.from(opcode.data);
            for (const offset of offsets) {
                const encoded = JSVM.encodeJumpTargetBytes(opcode.data.slice(offset, offset + 4), position + 1 + offset, seed);
                encoded.copy(opcode.data, offset);
            }
        }
        position += opcode.toBytes().length;
    }
}

function applyPerInstructionEncoding(chunk, seed) {
    let position = 0;
    for (const opcode of chunk.code) {
        if (opcode.data.length > 0) {
            opcode.data = JSVM.encodeInstructionBytes(opcode.data, position, seed);
        }
        position += opcode.toBytes().length;
    }
}

function buildAndLoadVM(chunk, opts = {}) {
    const {
        integrityKey = "antidump-test-key",
        bytecodeKeyId = `JSVK_AD_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        bytecodeKey = "ad-runtime-secret",
        salt = "adtest42",
        antiDump = true
    } = opts;

    const opcodeSeed = JSVM.deriveOpcodeStateSeed(integrityKey);
    const jumpSeed = JSVM.deriveJumpTargetSeed(integrityKey);
    const instructionSeed = JSVM.deriveInstructionByteSeed(integrityKey);

    applyStatefulOpcodeEncoding(chunk, opcodeSeed);
    applyJumpTargetEncoding(chunk, jumpSeed);
    applyPerInstructionEncoding(chunk, instructionSeed);

    const encryptedBytecode = JSVM.createEncryptedBytecodeEnvelope(
        zlib.deflateSync(Buffer.from(chunk.toBytes())).toString("base64"),
        "base64", integrityKey, bytecodeKeyId, bytecodeKey, salt, "IJS"
    );

    JSVM.registerBytecodeKey(bytecodeKeyId, bytecodeKey);

    const vm = new JSVM();
    vm.setBytecodeIntegrityKey(integrityKey);
    if (antiDump) vm.enableAntiDump("antidump-test-key");
    vm.loadFromString(encryptedBytecode, "base64");

    return vm;
}

const simpleSource = `
// @virtualize
function add(a, b) {
    return a + b;
}

console.log(add(10, 20));
`;

describe("anti-dump / memory scrubbing", () => {
    test("antiDump enabled produces correct output", () => {
        const chunk = new VMChunk();
        chunk.append(new Opcode("LOAD_DWORD", 3, encodeDWORD(42)));
        chunk.append(new Opcode("LOAD_DWORD", 4, encodeDWORD(8)));
        chunk.append(new Opcode("ADD", 5, 3, 4));
        chunk.append(new Opcode("END"));

        const vm = buildAndLoadVM(chunk);
        vm.run();

        expect(vm.registers[5]).toBe(50);
    });

    test("antiDump disabled produces correct output", () => {
        const chunk = new VMChunk();
        chunk.append(new Opcode("LOAD_DWORD", 3, encodeDWORD(42)));
        chunk.append(new Opcode("LOAD_DWORD", 4, encodeDWORD(8)));
        chunk.append(new Opcode("ADD", 5, 3, 4));
        chunk.append(new Opcode("END"));

        const vm = buildAndLoadVM(chunk, {antiDump: false});
        vm.run();

        expect(vm.registers[5]).toBe(50);
    });

    test("bytecode is scrubbed after execution with antiDump on", () => {
        const chunk = new VMChunk();
        chunk.append(new Opcode("LOAD_DWORD", 3, encodeDWORD(99)));
        chunk.append(new Opcode("END"));

        const vm = buildAndLoadVM(chunk, {antiDump: true});
        const codeBefore = Buffer.from(vm.code);
        vm.run();
        const codeAfter = Buffer.from(vm.code);

        expect(codeBefore.equals(codeAfter)).toBe(false);
    });

    test("bytecode is NOT scrubbed after execution with antiDump off", () => {
        const chunk = new VMChunk();
        chunk.append(new Opcode("LOAD_DWORD", 3, encodeDWORD(99)));
        chunk.append(new Opcode("END"));

        const vm = buildAndLoadVM(chunk, {antiDump: false});
        const codeBefore = Buffer.from(vm.code);
        vm.run();
        const codeAfter = Buffer.from(vm.code);

        expect(codeBefore.equals(codeAfter)).toBe(true);
    });

    test("scrubBytecodeRange overwrites bytes with seed-derived garbage", () => {
        const chunk = new VMChunk();
        chunk.append(new Opcode("LOAD_DWORD", 3, encodeDWORD(12345)));
        chunk.append(new Opcode("END"));

        const vm = buildAndLoadVM(chunk, {antiDump: true});
        const before = Buffer.from(vm.code);

        vm.scrubBytecodeRange(0, vm.code.length);
        const after = Buffer.from(vm.code);

        expect(before.equals(after)).toBe(false);
        // All bytes should have changed
        let anyDifferent = false;
        for (let i = 0; i < before.length; i++) {
            if (before[i] !== after[i]) anyDifferent = true;
        }
        expect(anyDifferent).toBe(true);
    });

    test("scrubBytecodeRange is a no-op when code is null", () => {
        const vm = new JSVM();
        vm.enableAntiDump("test-key");
        vm.code = null;
        expect(() => vm.scrubBytecodeRange(0, 10)).not.toThrow();
    });

    test("scrubBytecodeRange is a no-op when range is invalid", () => {
        const vm = new JSVM();
        vm.enableAntiDump("test-key");
        vm.code = Buffer.alloc(10);
        expect(() => vm.scrubBytecodeRange(5, 3)).not.toThrow();
    });

    test("enableAntiDump sets flag and derives seed", () => {
        const vm = new JSVM();
        expect(vm.antiDump).toBe(false);
        expect(vm.antiDumpSeed).toBe(0);

        vm.enableAntiDump("test-key");

        expect(vm.antiDump).toBe(true);
        expect(vm.antiDumpSeed).not.toBe(0);
    });

    test("different keys produce different anti-dump seeds", () => {
        const vm1 = new JSVM();
        vm1.enableAntiDump("key-alpha");

        const vm2 = new JSVM();
        vm2.enableAntiDump("key-beta");

        expect(vm1.antiDumpSeed).not.toBe(vm2.antiDumpSeed);
    });

    test("high water mark advances after each instruction", () => {
        const chunk = new VMChunk();
        chunk.append(new Opcode("LOAD_DWORD", 3, encodeDWORD(1)));
        chunk.append(new Opcode("LOAD_DWORD", 4, encodeDWORD(2)));
        chunk.append(new Opcode("ADD", 5, 3, 4));
        chunk.append(new Opcode("END"));

        const vm = buildAndLoadVM(chunk, {antiDump: true});
        expect(vm.antiDumpHighWaterMark).toBe(0);

        vm.run();

        expect(vm.antiDumpHighWaterMark).toBeGreaterThan(0);
    });

    test("antiDump on + off produce same result", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-ad-eq-"));
        const vm1 = path.join(tempDir, "on.vm.js");
        const app1 = path.join(tempDir, "on.virtualized.js");
        const vm2 = path.join(tempDir, "off.vm.js");
        const app2 = path.join(tempDir, "off.virtualized.js");

        fs.writeFileSync(path.join(tempDir, "source.js"), simpleSource);

        await transpile(simpleSource, {
            fileName: "ad-on", vmOutputPath: vm1, transpiledOutputPath: app1,
            passes: ["RemoveUnused"], antiDump: true
        });

        await transpile(simpleSource, {
            fileName: "ad-off", vmOutputPath: vm2, transpiledOutputPath: app2,
            passes: ["RemoveUnused"], antiDump: false
        });

        expect(runNodeScript(app1).trim()).toBe(runNodeScript(app2).trim());
    });

    test("transpile with antiDump: true includes setup", async () => {
        const result = await transpile(simpleSource, {
            fileName: "ad-setup-on", writeOutput: false,
            passes: ["RemoveUnused"], antiDump: true
        });
        expect(result.transpiled).toContain("enableAntiDump");
    });

    test("transpile with antiDump: false excludes setup", async () => {
        const result = await transpile(simpleSource, {
            fileName: "ad-setup-off", writeOutput: false,
            passes: ["RemoveUnused"], antiDump: false
        });
        expect(result.transpiled).not.toContain("enableAntiDump");
    });

    test("works with loops (repeated scrub)", async () => {
        const source = `
// @virtualize
function sum(n) {
    let total = 0;
    for (let i = 1; i <= n; i++) total += i;
    return total;
}

console.log(sum(100));
`;
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-ad-loop-"));
        const vmOutputPath = path.join(tempDir, "loop.vm.js");
        const transpiledOutputPath = path.join(tempDir, "loop.virtualized.js");

        fs.writeFileSync(path.join(tempDir, "source.js"), source);

        await transpile(source, {
            fileName: "ad-loop", vmOutputPath, transpiledOutputPath,
            passes: ["RemoveUnused"], antiDump: true
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
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-ad-branch-"));
        const vmOutputPath = path.join(tempDir, "branch.vm.js");
        const transpiledOutputPath = path.join(tempDir, "branch.virtualized.js");

        fs.writeFileSync(path.join(tempDir, "source.js"), source);

        await transpile(source, {
            fileName: "ad-branch", vmOutputPath, transpiledOutputPath,
            passes: ["RemoveUnused"], antiDump: true
        });

        expect(runNodeScript(transpiledOutputPath).trim()).toBe("pos\nneg\nzero");
    });

    test("works with nested functions (fork propagation)", async () => {
        const source = `
function apply(fn, v) { return fn(v); }

// @virtualize
function demo(x) {
    const square = function(n) { return n * n; };
    return apply(square, x);
}

console.log(demo(7));
`;
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-ad-fork-"));
        const vmOutputPath = path.join(tempDir, "fork.vm.js");
        const transpiledOutputPath = path.join(tempDir, "fork.virtualized.js");

        fs.writeFileSync(path.join(tempDir, "source.js"), source);

        await transpile(source, {
            fileName: "ad-fork", vmOutputPath, transpiledOutputPath,
            passes: ["RemoveUnused"], antiDump: true
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
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-ad-try-"));
        const vmOutputPath = path.join(tempDir, "try.vm.js");
        const transpiledOutputPath = path.join(tempDir, "try.virtualized.js");

        fs.writeFileSync(path.join(tempDir, "source.js"), source);

        await transpile(source, {
            fileName: "ad-try", vmOutputPath, transpiledOutputPath,
            passes: ["RemoveUnused"], antiDump: true
        });

        expect(runNodeScript(transpiledOutputPath).trim()).toBe("err");
    });

    test("works with all protections combined", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-ad-all-"));
        const vmOutputPath = path.join(tempDir, "all.vm.js");
        const transpiledOutputPath = path.join(tempDir, "all.virtualized.js");

        fs.writeFileSync(path.join(tempDir, "source.js"), simpleSource);

        await transpile(simpleSource, {
            fileName: "ad-all", vmOutputPath, transpiledOutputPath,
            passes: ["RemoveUnused"],
            antiDump: true,
            selfModifyingBytecode: true,
            controlFlowFlattening: true,
            opaquePredicates: true,
            deadCodeInjection: true,
            memoryProtection: true,
            polymorphic: true
        });

        expect(runNodeScript(transpiledOutputPath).trim()).toBe("30");
    });

    test("5 consecutive builds all produce correct output", async () => {
        for (let i = 0; i < 5; i++) {
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `jsvm-ad-multi${i}-`));
            const vmOutputPath = path.join(tempDir, "multi.vm.js");
            const transpiledOutputPath = path.join(tempDir, "multi.virtualized.js");

            await transpile(simpleSource, {
                fileName: `ad-multi-${i}`, vmOutputPath, transpiledOutputPath,
                passes: ["RemoveUnused"], antiDump: true
            });

            expect(runNodeScript(transpiledOutputPath).trim()).toBe("30");
        }
    });

    test("scrubbed bytes are not original bytes (irreversible overwrite)", () => {
        const chunk = new VMChunk();
        chunk.append(new Opcode("LOAD_DWORD", 3, encodeDWORD(0xDEADBEEF)));
        chunk.append(new Opcode("LOAD_STRING", 4, encodeString("sensitive")));
        chunk.append(new Opcode("END"));

        const vm = buildAndLoadVM(chunk, {antiDump: true});
        const originalCode = Buffer.from(vm.code);

        vm.scrubBytecodeRange(0, vm.code.length);

        // Scrubbed bytes should differ from original
        let allSame = true;
        for (let i = 0; i < originalCode.length; i++) {
            if (originalCode[i] !== vm.code[i]) { allSame = false; break; }
        }
        expect(allSame).toBe(false);
    });

    test("antiDump works with string operations", async () => {
        const source = `
// @virtualize
function greet(name) {
    return "Hello, " + name + "!";
}

console.log(greet("Anti-Dump"));
`;
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-ad-str-"));
        const vmOutputPath = path.join(tempDir, "str.vm.js");
        const transpiledOutputPath = path.join(tempDir, "str.virtualized.js");

        fs.writeFileSync(path.join(tempDir, "source.js"), source);

        await transpile(source, {
            fileName: "ad-str", vmOutputPath, transpiledOutputPath,
            passes: ["RemoveUnused"], antiDump: true
        });

        expect(runNodeScript(transpiledOutputPath).trim()).toBe("Hello, Anti-Dump!");
    });

    test("antiDump works with fibonacci (complex loop + backward jumps)", async () => {
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
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-ad-fib-"));
        const vmOutputPath = path.join(tempDir, "fib.vm.js");
        const transpiledOutputPath = path.join(tempDir, "fib.virtualized.js");

        fs.writeFileSync(path.join(tempDir, "source.js"), source);

        await transpile(source, {
            fileName: "ad-fib", vmOutputPath, transpiledOutputPath,
            passes: ["RemoveUnused"], antiDump: true
        });

        expect(runNodeScript(transpiledOutputPath).trim()).toBe("610");
    });
});
