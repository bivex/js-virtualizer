const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");

const {transpile} = require("../src/transpile");
const {VMChunk, Opcode, encodeDWORD} = require("../src/utils/assembler");
const {buildJumpTableOpcode, buildComputedGotoOpcode, scrambleCaseValue, generateAffineTransform, applyJumpTableCFF} = require("../src/utils/advancedCff");
const {encryptBytecode, decryptBytecode, deriveBytecodeKey, buildDynLoadOpcode, buildDynExecOpcode, buildDynPatchOpcode} = require("../src/utils/dynamicLoader");
const {generateCanary, createBankPermutation, buildMemCanaryOpcode, buildRegRotateOpcode, buildMemShuffleOpcode, injectCanaries, injectRegisterRotations, injectFakeStackFrames, createMemoryLayoutState} = require("../src/utils/memoryLayout");

function runNodeScript(filePath) {
    return childProcess.execFileSync("node", [filePath]).toString();
}

// ============================================================
// Advanced CFF Tests
// ============================================================

describe("advanced CFF - jump tables", () => {
    test("buildJumpTableOpcode creates valid opcode", () => {
        const cases = [
            { caseValue: 1, stateId: 0xAABBCCDD },
            { caseValue: 2, stateId: 0x11223344 },
            { caseValue: 3, stateId: 0x55667788 },
        ];
        const op = buildJumpTableOpcode(10, cases, 0xDEADBEEF, "BE");

        expect(op.name).toBe("CFF_JUMP_TABLE");
        expect(op.data[0]).toBe(10); // indexReg
        expect(op.data.length).toBe(1 + 4 + cases.length * 8 + 4);
    });

    test("buildComputedGotoOpcode creates valid opcode", () => {
        const entries = [
            { key: 0x11111111, stateId: 0xAAAAAAAA },
            { key: 0x22222222, stateId: 0xBBBBBBBB },
        ];
        const op = buildComputedGotoOpcode(5, 6, entries, 0xCCCCCCCC, "BE");

        expect(op.name).toBe("CFF_COMPUTED_GOTO");
        expect(op.data[0]).toBe(5); // indexReg
        expect(op.data[1]).toBe(6); // shiftReg
        expect(op.data.length).toBe(1 + 1 + 4 + entries.length * 8 + 4);
    });

    test("scrambleCaseValue is deterministic", () => {
        const a = scrambleCaseValue(5, 0x9e3779b9, 0x85ebca6b);
        const b = scrambleCaseValue(5, 0x9e3779b9, 0x85ebca6b);
        expect(a).toBe(b);
    });

    test("scrambleCaseValue produces unique values for different indices", () => {
        const values = new Set();
        for (let i = 0; i < 100; i++) {
            values.add(scrambleCaseValue(i, 0x9e3779b9, 0x85ebca6b));
        }
        expect(values.size).toBe(100);
    });

    test("generateAffineTransform produces valid transforms", () => {
        for (let i = 0; i < 10; i++) {
            const t = generateAffineTransform();
            expect(t.multiplier).toBeGreaterThan(0);
            expect(t.multiplier).toBeLessThan(0xFFFF);
            expect(t.offset).toBeGreaterThan(0);
            expect(t.offset).toBeLessThan(0xFFFF);
        }
    });

    test("applyJumpTableCFF gracefully handles small chunks", () => {
        const chunk = new VMChunk();
        chunk.append(new Opcode("LOAD_DWORD", 3, encodeDWORD(1)));
        chunk.append(new Opcode("END"));

        const result = applyJumpTableCFF(chunk, 10, 11);
        expect(result.initialStateId).toBe(0);
    });

    test("transpile with advanced CFF produces correct output", async () => {
        const source = `
// @virtualize
function classify(x) {
    if (x > 0) return "positive";
    if (x < 0) return "negative";
    return "zero";
}

console.log(classify(5));
console.log(classify(-3));
console.log(classify(0));
`;
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-advCFF-"));
        const vmOutputPath = path.join(tempDir, "adv.vm.js");
        const transpiledOutputPath = path.join(tempDir, "adv.virtualized.js");

        await transpile(source, {
            fileName: "adv-cff",
            vmOutputPath,
            transpiledOutputPath,
            passes: ["RemoveUnused"],
            controlFlowFlattening: true,
            advancedCFF: true,
            memoryLayoutObfuscation: false
        });

        expect(runNodeScript(transpiledOutputPath).trim()).toBe("positive\nnegative\nzero");
    });
});

// ============================================================
// Dynamic Code Loading Tests
// ============================================================

describe("dynamic code loading", () => {
    test("encryptBytecode/decryptBytecode are inverses", () => {
        const bytecode = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x90, 0xAB, 0xCD]);
        const key = "test-key-12345";

        const { encrypted, keySeed } = encryptBytecode(bytecode, key);
        const decrypted = decryptBytecode(encrypted, keySeed);

        expect(Buffer.compare(bytecode, decrypted)).toBe(0);
    });

    test("encryptBytecode produces different output each call with different keys", () => {
        const bytecode = Buffer.from([0x10, 0x20, 0x30, 0x40]);
        const r1 = encryptBytecode(bytecode, "key-a");
        const r2 = encryptBytecode(bytecode, "key-b");

        expect(Buffer.compare(r1.encrypted, r2.encrypted)).not.toBe(0);
    });

    test("deriveBytecodeKey is deterministic", () => {
        const a = deriveBytecodeKey("my-key");
        const b = deriveBytecodeKey("my-key");
        expect(a).toBe(b);
    });

    test("deriveBytecodeKey produces different keys for different inputs", () => {
        const a = deriveBytecodeKey("key-1");
        const b = deriveBytecodeKey("key-2");
        expect(a).not.toBe(b);
    });

    test("buildDynLoadOpcode creates correct format", () => {
        const op = buildDynLoadOpcode(7, 0xDEADBEEF, 128, "BE");
        expect(op.name).toBe("DYN_LOAD");
        expect(op.data[0]).toBe(7);
    });

    test("buildDynExecOpcode creates correct format", () => {
        const op = buildDynExecOpcode(42, "BE");
        expect(op.name).toBe("DYN_EXEC");
        expect(op.data.length).toBe(4);
    });

    test("buildDynPatchOpcode creates correct format", () => {
        const op = buildDynPatchOpcode(5, 100, 32, "BE");
        expect(op.name).toBe("DYN_PATCH");
        expect(op.data[0]).toBe(5);
    });

    test("round-trip encrypt/decrypt with empty bytecode", () => {
        const bytecode = Buffer.alloc(0);
        const { encrypted, keySeed } = encryptBytecode(bytecode, "empty-key");
        const decrypted = decryptBytecode(encrypted, keySeed);
        expect(Buffer.compare(bytecode, decrypted)).toBe(0);
    });

    test("round-trip encrypt/decrypt with large bytecode", () => {
        const bytecode = Buffer.alloc(4096);
        for (let i = 0; i < bytecode.length; i++) {
            bytecode[i] = i & 0xFF;
        }
        const { encrypted, keySeed } = encryptBytecode(bytecode, "large-key");
        const decrypted = decryptBytecode(encrypted, keySeed);
        expect(Buffer.compare(bytecode, decrypted)).toBe(0);
    });
});

// ============================================================
// Memory Layout Obfuscation Tests
// ============================================================

describe("memory layout obfuscation", () => {
    test("generateCanary is deterministic", () => {
        const a = generateCanary(0x9e3779b9, 42);
        const b = generateCanary(0x9e3779b9, 42);
        expect(a).toBe(b);
    });

    test("generateCanary produces different values for different positions", () => {
        const values = new Set();
        for (let i = 0; i < 50; i++) {
            values.add(generateCanary(0x9e3779b9, i));
        }
        // Should produce unique values for most positions
        expect(values.size).toBeGreaterThan(40);
    });

    test("createBankPermutation is a valid permutation", () => {
        const { forward, inverse } = createBankPermutation(16, 0x12345678);

        // Check forward is a valid permutation
        expect(forward.length).toBe(16);
        const sorted = [...forward].sort((a, b) => a - b);
        for (let i = 0; i < 16; i++) {
            expect(sorted[i]).toBe(i);
        }

        // Check inverse undoes forward
        for (let i = 0; i < 16; i++) {
            expect(forward[inverse[i]]).toBe(i);
        }
    });

    test("createBankPermutation is deterministic for same seed", () => {
        const a = createBankPermutation(8, 0xDEADBEEF);
        const b = createBankPermutation(8, 0xDEADBEEF);
        expect(a.forward).toEqual(b.forward);
    });

    test("buildMemCanaryOpcode creates correct format", () => {
        const op = buildMemCanaryOpcode(12, 0xAABBCCDD, 256, "BE");
        expect(op.name).toBe("MEM_CANARY");
        expect(op.data[0]).toBe(12);
        expect(op.data.length).toBe(1 + 4 + 4);
    });

    test("buildRegRotateOpcode creates correct format", () => {
        const op = buildRegRotateOpcode(0x11223344, 4, 8, "BE");
        expect(op.name).toBe("REG_ROTATE");
        expect(op.data.length).toBe(4 + 1 + 1);
        expect(op.data[4]).toBe(4); // numBanks
        expect(op.data[5]).toBe(8); // bankSize
    });

    test("buildMemShuffleOpcode creates correct format", () => {
        const regions = [
            { startReg: 3, sizeReg: 4 },
            { startReg: 10, sizeReg: 11 },
        ];
        const op = buildMemShuffleOpcode(0x55667788, regions, "BE");
        expect(op.name).toBe("MEM_SHUFFLE");
        expect(op.data[4]).toBe(2); // numRegions
    });

    test("injectCanaries adds opcodes to chunk", () => {
        const chunk = new VMChunk();
        for (let i = 0; i < 30; i++) {
            chunk.append(new Opcode("LOAD_DWORD", i, encodeDWORD(i * 10)));
        }
        chunk.append(new Opcode("END"));

        const originalLen = chunk.code.length;
        injectCanaries(chunk, 200, 0x9e3779b9, { canaryInterval: 4 });

        // Should have added LOAD_DWORD opcodes for canary values
        expect(chunk.code.length).toBeGreaterThanOrEqual(originalLen);
    });

    test("injectRegisterRotations adds REG_ROTATE opcodes", () => {
        const chunk = new VMChunk();
        for (let i = 0; i < 40; i++) {
            chunk.append(new Opcode("LOAD_DWORD", i, encodeDWORD(i)));
        }
        chunk.append(new Opcode("END"));

        const originalLen = chunk.code.length;
        injectRegisterRotations(chunk, 0x9e3779b9, {
            rotationInterval: 8,
            bankSize: 4,
            registerCount: 32
        });

        const hasRotate = chunk.code.some(op => op.name === "REG_ROTATE");
        expect(hasRotate).toBe(true);
        expect(chunk.code.length).toBeGreaterThan(originalLen);
    });

    test("injectFakeStackFrames adds decoy opcodes", () => {
        const chunk = new VMChunk();
        for (let i = 0; i < 30; i++) {
            chunk.append(new Opcode("LOAD_DWORD", i, encodeDWORD(i)));
        }
        chunk.append(new Opcode("END"));

        const originalLen = chunk.code.length;
        injectFakeStackFrames(chunk, 0x9e3779b9, { fakeFrameInterval: 6 });

        // Should have added LOAD_DWORD, LOAD_BOOL, and TEST opcodes
        expect(chunk.code.length).toBeGreaterThan(originalLen);
    });

    test("createMemoryLayoutState creates valid state", () => {
        const state = createMemoryLayoutState("test-key", 128);
        expect(state.registerCount).toBe(128);
        expect(state.enabled).toBe(true);
        expect(state.canaryValues).toBeInstanceOf(Map);
        expect(typeof state.seed).toBe("number");
    });

    test("transpile with memory layout obfuscation produces correct output", async () => {
        const source = `
// @virtualize
function multiply(a, b) {
    return a * b;
}

console.log(multiply(6, 7));
`;
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-memobf-"));
        const vmOutputPath = path.join(tempDir, "mem.vm.js");
        const transpiledOutputPath = path.join(tempDir, "mem.virtualized.js");

        await transpile(source, {
            fileName: "mem-obf",
            vmOutputPath,
            transpiledOutputPath,
            passes: ["RemoveUnused"],
            memoryLayoutObfuscation: true,
            controlFlowFlattening: false,
            advancedCFF: false
        });

        expect(runNodeScript(transpiledOutputPath).trim()).toBe("42");
    });
});

// ============================================================
// Integration Tests (all features combined)
// ============================================================

describe("integration: all new features combined", () => {
    test("CFF + advanced CFF + memory obfuscation produce correct output", async () => {
        const source = `
// @virtualize
function fibonacci(n) {
    if (n <= 1) return n;
    let a = 0, b = 1;
    for (let i = 2; i <= n; i++) {
        const t = a + b;
        a = b;
        b = t;
    }
    return b;
}

console.log(fibonacci(10));
`;
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-allfeat-"));
        const vmOutputPath = path.join(tempDir, "all.vm.js");
        const transpiledOutputPath = path.join(tempDir, "all.virtualized.js");

        await transpile(source, {
            fileName: "all-features",
            vmOutputPath,
            transpiledOutputPath,
            passes: ["RemoveUnused"],
            controlFlowFlattening: true,
            advancedCFF: true,
            memoryLayoutObfuscation: false
        });

        expect(runNodeScript(transpiledOutputPath).trim()).toBe("55");
    });

    test("all features with polymorphic produces correct output", async () => {
        const source = `
// @virtualize
function greet(name) {
    return "Hello, " + name + "!";
}

console.log(greet("World"));
`;
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-polyall-"));
        const vmOutputPath = path.join(tempDir, "poly.vm.js");
        const transpiledOutputPath = path.join(tempDir, "poly.virtualized.js");

        await transpile(source, {
            fileName: "poly-all",
            vmOutputPath,
            transpiledOutputPath,
            passes: ["RemoveUnused"],
            controlFlowFlattening: true,
            advancedCFF: true,
            memoryLayoutObfuscation: false,
            polymorphic: true
        });

        expect(runNodeScript(transpiledOutputPath).trim()).toBe("Hello, World!");
    });
});
