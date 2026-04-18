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
        JUMP_UNCONDITIONAL: [0],
        JUMP_EQ: [1],
        JUMP_NOT_EQ: [1],
        TRY_CATCH_FINALLY: [1, 5],
        MACRO_TEST_JUMP_EQ: [3],
        MACRO_TEST_JUMP_NOT_EQ: [3]
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
        integrityKey = "smb-test-key",
        bytecodeKeyId = `JSVK_SMB_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        bytecodeKey = "smb-runtime-secret",
        salt = "smbtest42",
        selfModifying = true
    } = opts;

    const opcodeSeed = JSVM.deriveOpcodeStateSeed(integrityKey);
    const jumpSeed = JSVM.deriveJumpTargetSeed(integrityKey);
    const instructionSeed = JSVM.deriveInstructionByteSeed(integrityKey);

    applyStatefulOpcodeEncoding(chunk, opcodeSeed);
    applyJumpTargetEncoding(chunk, jumpSeed);
    applyPerInstructionEncoding(chunk, instructionSeed);

    const encryptedBytecode = JSVM.createEncryptedBytecodeEnvelope(
        zlib.deflateSync(Buffer.from(chunk.toBytes())).toString("base64"),
        "base64",
        integrityKey,
        bytecodeKeyId,
        bytecodeKey,
        salt,
        "IJS"
    );

    JSVM.registerBytecodeKey(bytecodeKeyId, bytecodeKey);

    const vm = new JSVM();
    vm.setBytecodeIntegrityKey(integrityKey);
    if (selfModifying) {
        vm.enableSelfModifyingBytecode("smb-test-key");
    }
    vm.loadFromString(encryptedBytecode, "base64");

    return vm;
}

describe("self-modifying bytecode", () => {
    test("produces correct result with SMB enabled", () => {
        const chunk = new VMChunk();
        chunk.append(new Opcode("LOAD_DWORD", 3, encodeDWORD(42)));
        chunk.append(new Opcode("LOAD_DWORD", 4, encodeDWORD(8)));
        chunk.append(new Opcode("ADD", 5, 3, 4));
        chunk.append(new Opcode("END"));

        const vm = buildAndLoadVM(chunk);
        vm.run();

        expect(vm.registers[5]).toBe(50);
    });

    test("produces correct result with SMB disabled", () => {
        const chunk = new VMChunk();
        chunk.append(new Opcode("LOAD_DWORD", 3, encodeDWORD(100)));
        chunk.append(new Opcode("LOAD_DWORD", 4, encodeDWORD(23)));
        chunk.append(new Opcode("SUBTRACT", 5, 3, 4));
        chunk.append(new Opcode("END"));

        const vm = buildAndLoadVM(chunk, {selfModifying: false});
        vm.run();

        expect(vm.registers[5]).toBe(77);
    });

    test("SMB enabled and disabled produce same result", () => {
        const chunk1 = new VMChunk();
        chunk1.append(new Opcode("LOAD_DWORD", 3, encodeDWORD(15)));
        chunk1.append(new Opcode("LOAD_DWORD", 4, encodeDWORD(27)));
        chunk1.append(new Opcode("ADD", 5, 3, 4));
        chunk1.append(new Opcode("END"));

        const chunk2 = new VMChunk();
        chunk2.append(new Opcode("LOAD_DWORD", 3, encodeDWORD(15)));
        chunk2.append(new Opcode("LOAD_DWORD", 4, encodeDWORD(27)));
        chunk2.append(new Opcode("ADD", 5, 3, 4));
        chunk2.append(new Opcode("END"));

        const vmSMB = buildAndLoadVM(chunk1, {selfModifying: true});
        vmSMB.run();

        const vmNoSMB = buildAndLoadVM(chunk2, {selfModifying: false});
        vmNoSMB.run();

        expect(vmSMB.registers[5]).toBe(vmNoSMB.registers[5]);
        expect(vmSMB.registers[5]).toBe(42);
    });

    test("codeBackup is created when SMB is enabled", () => {
        const chunk = new VMChunk();
        chunk.append(new Opcode("LOAD_DWORD", 3, encodeDWORD(1)));
        chunk.append(new Opcode("END"));

        const vm = buildAndLoadVM(chunk, {selfModifying: true});

        expect(vm.codeBackup).not.toBeNull();
        expect(vm.codeBackup.length).toBe(vm.code.length);
    });

    test("codeBackup is null when SMB is disabled", () => {
        const chunk = new VMChunk();
        chunk.append(new Opcode("LOAD_DWORD", 3, encodeDWORD(1)));
        chunk.append(new Opcode("END"));

        const vm = buildAndLoadVM(chunk, {selfModifying: false});

        expect(vm.codeBackup).toBeNull();
    });

    test("bytecode is mutated after execution", () => {
        const chunk = new VMChunk();
        chunk.append(new Opcode("LOAD_DWORD", 3, encodeDWORD(99)));
        chunk.append(new Opcode("END"));

        const vm = buildAndLoadVM(chunk, {selfModifying: true});
        const codeBeforeRun = Buffer.from(vm.code);
        vm.run();
        const codeAfterRun = Buffer.from(vm.code);

        const mutated = !codeBeforeRun.equals(codeAfterRun);
        expect(mutated).toBe(true);
    });

    test("bytecode is NOT mutated when SMB is disabled", () => {
        const chunk = new VMChunk();
        chunk.append(new Opcode("LOAD_DWORD", 3, encodeDWORD(99)));
        chunk.append(new Opcode("END"));

        const vm = buildAndLoadVM(chunk, {selfModifying: false});
        const codeBeforeRun = Buffer.from(vm.code);
        vm.run();
        const codeAfterRun = Buffer.from(vm.code);

        expect(codeBeforeRun.equals(codeAfterRun)).toBe(true);
    });

    test("restoreBytecodeRange restores scrambled region", () => {
        const chunk = new VMChunk();
        chunk.append(new Opcode("LOAD_DWORD", 3, encodeDWORD(55)));
        chunk.append(new Opcode("END"));

        const vm = buildAndLoadVM(chunk, {selfModifying: true});
        const originalCode = Buffer.from(vm.code);

        vm.scrambleInstruction(0, vm.code.length);
        const afterScramble = Buffer.from(vm.code);
        expect(afterScramble.equals(originalCode)).toBe(false);

        vm.restoreBytecodeRange(0, vm.code.length);
        const afterRestore = Buffer.from(vm.code);
        expect(afterRestore.equals(originalCode)).toBe(true);
    });

    test("jump backward triggers restoreBytecodeRange", () => {
        const chunk = new VMChunk();
        // Loop: load 0, jump over block, load 1, add, conditional jump back
        chunk.append(new Opcode("LOAD_DWORD", 3, encodeDWORD(10)));
        chunk.append(new Opcode("LOAD_BOOL", 4, 1));
        chunk.append(new Opcode("JUMP_EQ", 4, encodeDWORD(14)));
        chunk.append(new Opcode("LOAD_DWORD", 5, encodeDWORD(99)));
        chunk.append(new Opcode("END"));

        const vm = buildAndLoadVM(chunk, {selfModifying: true});
        vm.run();

        expect(vm.registers[3]).toBe(10);
        expect(vm.registers[4]).toBe(true);
    });

    test("fork restores bytecode from backup before execution", async () => {
        const source = `
function apply(fn, val) {
    return fn(val);
}

// @virtualize
function demo(input) {
    const double = function(x) { return x * 2; };
    return apply(double, input);
}

console.log(demo(7));
`;
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-smb-fork-"));
        const vmOutputPath = path.join(tempDir, "smb-fork.vm.js");
        const transpiledOutputPath = path.join(tempDir, "smb-fork.virtualized.js");

        fs.writeFileSync(path.join(tempDir, "source.js"), source);

        const result = await transpile(source, {
            fileName: "smb-fork",
            vmOutputPath,
            transpiledOutputPath,
            passes: ["RemoveUnused"],
            selfModifyingBytecode: true
        });

        const output = runNodeScript(transpiledOutputPath).trim();
        expect(output).toBe("14");
    });

    test("transpile with selfModifyingBytecode: false disables SMB", async () => {
        const source = `
// @virtualize
function demo() {
    return "no-smb";
}

console.log(demo());
`;
        const result = await transpile(source, {
            fileName: "smb-disabled",
            writeOutput: false,
            passes: ["RemoveUnused"],
            selfModifyingBytecode: false
        });

        expect(result.transpiled).not.toContain("enableSelfModifyingBytecode");
    });

    test("transpile with selfModifyingBytecode: true includes setup", async () => {
        const source = `
// @virtualize
function demo() {
    return "with-smb";
}

console.log(demo());
`;
        const result = await transpile(source, {
            fileName: "smb-enabled",
            writeOutput: false,
            passes: ["RemoveUnused"],
            selfModifyingBytecode: true
        });

        expect(result.transpiled).toContain("enableSelfModifyingBytecode");
    });

    test("SMB works with loops (repeated backward jumps)", async () => {
        const source = `
// @virtualize
function sum(n) {
    let total = 0;
    for (let i = 1; i <= n; i++) {
        total += i;
    }
    return total;
}

console.log(sum(10));
`;
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-smb-loop-"));
        const vmOutputPath = path.join(tempDir, "smb-loop.vm.js");
        const transpiledOutputPath = path.join(tempDir, "smb-loop.virtualized.js");

        fs.writeFileSync(path.join(tempDir, "source.js"), source);

        const result = await transpile(source, {
            fileName: "smb-loop",
            vmOutputPath,
            transpiledOutputPath,
            passes: ["RemoveUnused"],
            selfModifyingBytecode: true
        });

        const output = runNodeScript(transpiledOutputPath).trim();
        expect(output).toBe("55");
    });

    test("SMB works with branching (conditional jumps)", async () => {
        const source = `
// @virtualize
function classify(n) {
    if (n > 0) {
        return "positive";
    } else if (n < 0) {
        return "negative";
    }
    return "zero";
}

console.log(classify(5));
console.log(classify(-3));
console.log(classify(0));
`;
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-smb-branch-"));
        const vmOutputPath = path.join(tempDir, "smb-branch.vm.js");
        const transpiledOutputPath = path.join(tempDir, "smb-branch.virtualized.js");

        fs.writeFileSync(path.join(tempDir, "source.js"), source);

        await transpile(source, {
            fileName: "smb-branch",
            vmOutputPath,
            transpiledOutputPath,
            passes: ["RemoveUnused"],
            selfModifyingBytecode: true
        });

        const output = runNodeScript(transpiledOutputPath).trim();
        expect(output).toBe("positive\nnegative\nzero");
    });

    test("multiple consecutive runs with SMB produce correct results", async () => {
        const source = `
// @virtualize
function compute(a, b) {
    return (a + b) * (a - b);
}

console.log(compute(10, 3));
`;
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-smb-multi-"));
        const vmOutputPath = path.join(tempDir, "smb-multi.vm.js");
        const transpiledOutputPath = path.join(tempDir, "smb-multi.virtualized.js");

        fs.writeFileSync(path.join(tempDir, "source.js"), source);

        await transpile(source, {
            fileName: "smb-multi",
            vmOutputPath,
            transpiledOutputPath,
            passes: ["RemoveUnused"],
            selfModifyingBytecode: true
        });

        const out1 = runNodeScript(transpiledOutputPath).trim();
        const out2 = runNodeScript(transpiledOutputPath).trim();
        const out3 = runNodeScript(transpiledOutputPath).trim();

        expect(out1).toBe("91");
        expect(out2).toBe("91");
        expect(out3).toBe("91");
    });

    test("enableSelfModifyingBytecode sets flag and derives seed", () => {
        const vm = new JSVM();
        expect(vm.selfModifyingBytecode).toBe(false);
        expect(vm.selfModifySeed).toBe(0);

        vm.enableSelfModifyingBytecode("test-key");

        expect(vm.selfModifyingBytecode).toBe(true);
        expect(vm.selfModifySeed).not.toBe(0);
    });

    test("different keys produce different SMB seeds", () => {
        const vm1 = new JSVM();
        vm1.enableSelfModifyingBytecode("key-alpha");

        const vm2 = new JSVM();
        vm2.enableSelfModifyingBytecode("key-beta");

        expect(vm1.selfModifySeed).not.toBe(vm2.selfModifySeed);
    });

    test("scrambleInstruction is a no-op when code is null", () => {
        const vm = new JSVM();
        vm.enableSelfModifyingBytecode("test-key");
        vm.code = null;

        expect(() => vm.scrambleInstruction(0, 10)).not.toThrow();
    });

    test("restoreBytecodeRange is a no-op when codeBackup is null", () => {
        const vm = new JSVM();
        vm.enableSelfModifyingBytecode("test-key");

        expect(() => vm.restoreBytecodeRange(0, 10)).not.toThrow();
    });
});
