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

const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");

const JSVM = require("../src/vm_dev");
const {transpile} = require("../src/transpile");
const {VMChunk, Opcode, encodeString} = require("../src/utils/assembler");

describe("obfuscation features", () => {
    test("encrypts string payloads in bytecode while preserving runtime behavior", () => {
        const secret = "ultra-secret-token";
        const encoded = encodeString(secret);
        const plaintextHex = Buffer.from(secret).toString("hex");
        const vm = new JSVM();
        const chunk = new VMChunk();

        expect(encoded.toString("hex")).not.toContain(plaintextHex);

        chunk.append(new Opcode("LOAD_STRING", 3, encoded));
        vm.loadFromString(chunk.toBytes());
        vm.run();

        expect(vm.registers[3]).toBe(secret);
    });

    test("scrambles top-level virtualized arguments without breaking defaults or rest params", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-obfuscation-"));
        const sourcePath = path.join(tempDir, "args.source.js");
        const vmOutputPath = path.join(tempDir, "args.vm.js");
        const transpiledOutputPath = path.join(tempDir, "args.virtualized.js");
        const source = `
// @virtualize
function demo(first, second = "fallback", ...rest) {
  return first + "|" + second + "|" + rest.join("|");
}

console.log(demo("alpha", undefined, "gamma", "delta"));
`;

        fs.writeFileSync(sourcePath, source);

        const result = await transpile(source, {
            fileName: "obfuscation-args.js",
            vmOutputPath,
            transpiledOutputPath,
            passes: ["RemoveUnused"]
        });

        expect(result.transpiled).toContain("__jsv_arg_");

        const originalOutput = childProcess.execSync(`node ${sourcePath}`).toString();
        const virtualizedOutput = childProcess.execSync(`node ${transpiledOutputPath}`).toString();

        expect(virtualizedOutput).toBe(originalOutput);
        expect(virtualizedOutput.trim()).toBe("alpha|fallback|gamma|delta");
    });

    test("scrambles internal callback arguments without breaking default or rest handling", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-obfuscation-"));
        const sourcePath = path.join(tempDir, "callback.source.js");
        const vmOutputPath = path.join(tempDir, "callback.vm.js");
        const transpiledOutputPath = path.join(tempDir, "callback.virtualized.js");
        const source = `
function invoke(callback) {
  return callback("alpha", undefined, "gamma", "delta");
}

// @virtualize
function demo() {
  const handler = function(first, second = "fallback", ...rest) {
    return first + "|" + second + "|" + rest.join("|");
  };

  return invoke(handler);
}

console.log(demo());
`;

        fs.writeFileSync(sourcePath, source);

        await transpile(source, {
            fileName: "obfuscation-callback.js",
            vmOutputPath,
            transpiledOutputPath,
            passes: ["RemoveUnused"]
        });

        const originalOutput = childProcess.execSync(`node ${sourcePath}`).toString();
        const virtualizedOutput = childProcess.execSync(`node ${transpiledOutputPath}`).toString();

        expect(virtualizedOutput).toBe(originalOutput);
        expect(virtualizedOutput.trim()).toBe("alpha|fallback|gamma|delta");
    });

    test("transpiled output no longer contains plaintext string literals", async () => {
        const secret = "top-secret-fingerprint";
        const result = await transpile(`
// @virtualize
function demo() {
  return "${secret}";
}

console.log(demo());
`, {
            fileName: "obfuscation-strings.js",
            writeOutput: false,
            passes: ["RemoveUnused"]
        });

        expect(result.transpiled).not.toContain(secret);
        expect(result.vm).not.toContain(secret);
    });
});
