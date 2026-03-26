/**
 * Copyright (c) 2026 Bivex
 *
 * Author: Bivex
 * Available for contact via email: support@b-b.top
 * For up-to-date contact information:
 * https://github.com/bivex
 *
 * Created: 2026-03-26 18:54
 * Last Updated: 2026-03-26 18:54
 *
 * Licensed under the MIT License.
 * Commercial licensing available upon request.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");
const zlib = require("node:zlib");

const JSVM = require("../src/vm_dev");
const {transpile} = require("../src/transpile");
const {VMChunk, Opcode, encodeDWORD, encodeString} = require("../src/utils/assembler");

function runNodeScript(filePath, options = {}) {
    return childProcess.execFileSync("node", [filePath], options).toString();
}

function applyStatefulOpcodeEncoding(chunk, seed) {
    let position = 0;

    for (const opcode of chunk.code) {
        opcode.opcode = Buffer.from([JSVM.encodeStatefulOpcode(opcode.opcode[0], position, seed)]);
        position += opcode.toBytes().length;
    }
}

function getJumpEncodingOffsets(opcodeName) {
    switch (opcodeName) {
        case "JUMP_UNCONDITIONAL":
            return [0];
        case "JUMP_EQ":
        case "JUMP_NOT_EQ":
            return [1];
        case "TRY_CATCH_FINALLY":
            return [1, 5];
        case "MACRO_TEST_JUMP_EQ":
        case "MACRO_TEST_JUMP_NOT_EQ":
            return [3];
        default:
            return [];
    }
}

function applyJumpTargetEncoding(chunk, seed) {
    let position = 0;

    for (const opcode of chunk.code) {
        const offsets = getJumpEncodingOffsets(opcode.name);
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

describe("bytecode integrity", () => {
    test("loads protected bytecode when key matches", () => {
        const vm = new JSVM();
        const chunk = new VMChunk();
        const key = "integrity-test-key";
        const salt = "feedc0de";

        chunk.append(new Opcode("LOAD_DWORD", 3, encodeDWORD(1337)));
        const rawBytecode = chunk.toBytes().toString("base64");
        const protectedBytecode = JSVM.createBytecodeIntegrityEnvelope(rawBytecode, "base64", key, salt);

        vm.setBytecodeIntegrityKey(key);
        vm.loadFromString(protectedBytecode, "base64");
        vm.run();

        expect(vm.registers[3]).toBe(1337);
    });

    test("rejects tampered protected bytecode", () => {
        const vm = new JSVM();
        const chunk = new VMChunk();
        const key = "integrity-test-key";
        const salt = "feedc0de";

        chunk.append(new Opcode("LOAD_DWORD", 3, encodeDWORD(1337)));
        const rawBytecode = chunk.toBytes().toString("base64");
        const protectedBytecode = JSVM.createBytecodeIntegrityEnvelope(rawBytecode, "base64", key, salt);
        const tamperedBytecode = `${protectedBytecode.slice(0, -1)}${protectedBytecode.slice(-1) === "A" ? "B" : "A"}`;

        vm.setBytecodeIntegrityKey(key);

        expect(() => vm.loadFromString(tamperedBytecode, "base64")).toThrow("Bytecode integrity check failed");
    });

    test("rejects protected bytecode when key mismatches", () => {
        const vm = new JSVM();
        const chunk = new VMChunk();

        chunk.append(new Opcode("LOAD_DWORD", 3, encodeDWORD(1337)));
        const rawBytecode = chunk.toBytes().toString("base64");
        const protectedBytecode = JSVM.createBytecodeIntegrityEnvelope(rawBytecode, "base64", "expected-key", "feedc0de");

        vm.setBytecodeIntegrityKey("wrong-key");

        expect(() => vm.loadFromString(protectedBytecode, "base64")).toThrow("Bytecode integrity check failed");
    });

    test("loads encrypted bytecode when runtime key is registered externally", () => {
        const vm = new JSVM();
        const chunk = new VMChunk();
        const integrityKey = "integrity-test-key";
        const bytecodeKeyId = "JSVK_TEST";
        const bytecodeKey = "runtime-secret-key";
        const salt = "feedc0de";
        const opcodeSeed = JSVM.deriveOpcodeStateSeed(integrityKey);
        const jumpSeed = JSVM.deriveJumpTargetSeed(integrityKey);
        const instructionSeed = JSVM.deriveInstructionByteSeed(integrityKey);

        chunk.append(new Opcode("LOAD_DWORD", 3, encodeDWORD(1337)));
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
        vm.setBytecodeIntegrityKey(integrityKey);
        vm.loadFromString(encryptedBytecode, "base64");
        vm.run();

        expect(vm.registers[3]).toBe(1337);
    });

    test("rejects encrypted bytecode when external runtime key is missing", () => {
        const vm = new JSVM();
        const chunk = new VMChunk();
        const integrityKey = "integrity-test-key";
        const bytecodeKeyId = `JSVK_MISSING_${Date.now()}`;
        const salt = "feedc0de";
        const opcodeSeed = JSVM.deriveOpcodeStateSeed(integrityKey);
        const jumpSeed = JSVM.deriveJumpTargetSeed(integrityKey);
        const instructionSeed = JSVM.deriveInstructionByteSeed(integrityKey);

        chunk.append(new Opcode("LOAD_DWORD", 3, encodeDWORD(1337)));
        applyStatefulOpcodeEncoding(chunk, opcodeSeed);
        applyJumpTargetEncoding(chunk, jumpSeed);
        applyPerInstructionEncoding(chunk, instructionSeed);

        const encryptedBytecode = JSVM.createEncryptedBytecodeEnvelope(
            zlib.deflateSync(Buffer.from(chunk.toBytes())).toString("base64"),
            "base64",
            integrityKey,
            bytecodeKeyId,
            "runtime-secret-key",
            salt,
            "IJS"
        );

        vm.setBytecodeIntegrityKey(integrityKey);

        expect(() => vm.loadFromString(encryptedBytecode, "base64")).toThrow("VM decryption key not available");
    });

    test("loads encrypted bytecode with encoded jump targets", () => {
        const vm = new JSVM();
        const chunk = new VMChunk();
        const integrityKey = "jump-integrity-key";
        const bytecodeKeyId = "JSVK_JUMP";
        const bytecodeKey = "jump-runtime-secret";
        const salt = "c0ffee42";
        const opcodeSeed = JSVM.deriveOpcodeStateSeed(integrityKey);
        const jumpSeed = JSVM.deriveJumpTargetSeed(integrityKey);
        const instructionSeed = JSVM.deriveInstructionByteSeed(integrityKey);

        chunk.append(new Opcode("LOAD_BOOL", 3, 1));
        chunk.append(new Opcode("JUMP_EQ", 3, encodeDWORD(13)));
        chunk.append(new Opcode("LOAD_DWORD", 4, encodeDWORD(7)));
        chunk.append(new Opcode("END"));
        chunk.append(new Opcode("LOAD_DWORD", 4, encodeDWORD(42)));
        chunk.append(new Opcode("END"));

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
        vm.setBytecodeIntegrityKey(integrityKey);
        vm.loadFromString(encryptedBytecode, "base64");
        vm.run();

        expect(vm.registers[4]).toBe(42);
    });

    test("loads encrypted bytecode with per-instruction decoding", () => {
        const vm = new JSVM();
        const chunk = new VMChunk();
        const integrityKey = "instruction-integrity-key";
        const bytecodeKeyId = "JSVK_INST";
        const bytecodeKey = "instruction-runtime-secret";
        const salt = "abcddcba";
        const opcodeSeed = JSVM.deriveOpcodeStateSeed(integrityKey);
        const jumpSeed = JSVM.deriveJumpTargetSeed(integrityKey);
        const instructionSeed = JSVM.deriveInstructionByteSeed(integrityKey);

        chunk.append(new Opcode("LOAD_STRING", 5, encodeString("test")));
        chunk.append(new Opcode("END"));

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
        vm.setBytecodeIntegrityKey(integrityKey);
        vm.loadFromString(encryptedBytecode, "base64");
        vm.run();

        expect(vm.registers[5]).toBe("test");
    });

    test("virtualized wrappers fail fast when protected payload is modified", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-integrity-"));
        const samplePath = path.join(tempDir, "integrity-sample.js");
        const originalOutputPath = path.join(tempDir, "integrity-sample.original.js");
        const tamperedOutputPath = path.join(tempDir, "integrity-sample.tampered.js");
        const vmOutputPath = path.join(tempDir, "integrity-sample.vm.js");

        const sample = `// @virtualize
function protectedResult() {
    return 42;
}

console.log(protectedResult());
`;

        fs.writeFileSync(samplePath, sample);

        const result = await transpile(sample, {
            fileName: "integrity-sample",
            writeOutput: true,
            vmOutputPath,
            transpiledOutputPath: originalOutputPath,
            passes: ["RemoveUnused"]
        });

        expect(result.transpiled).toContain("setBytecodeIntegrityKey");
        expect(result.transpiled).toContain("JSCX1:");

        const tampered = result.transpiled.replace(/JSCX1:[^']+/, (match) => {
            const last = match.slice(-1);
            return `${match.slice(0, -1)}${last === "A" ? "B" : "A"}`;
        });

        fs.writeFileSync(tamperedOutputPath, tampered);

        const originalOutput = runNodeScript(originalOutputPath).trim();
        expect(originalOutput).toBe("42");

        expect(() => runNodeScript(tamperedOutputPath, {stdio: "pipe"})).toThrow(/Bytecode integrity check failed/);
    });
});
