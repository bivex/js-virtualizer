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

const JSVM = require("../src/vm_dev");
const {transpile} = require("../src/transpile");
const {VMChunk, Opcode, encodeDWORD} = require("../src/utils/assembler");

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
        expect(result.transpiled).toContain("JSCI1:");

        const tampered = result.transpiled.replace(/JSCI1:[^']+/, (match) => {
            const last = match.slice(-1);
            return `${match.slice(0, -1)}${last === "A" ? "B" : "A"}`;
        });

        fs.writeFileSync(tamperedOutputPath, tampered);

        const originalOutput = childProcess.execSync(`node ${originalOutputPath}`).toString().trim();
        expect(originalOutput).toBe("42");

        expect(() => childProcess.execSync(`node ${tamperedOutputPath}`, {stdio: "pipe"})).toThrow(/Bytecode integrity check failed/);
    });
});
