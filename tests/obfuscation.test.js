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

function extractWrapperValue(pattern, source) {
    const match = source.match(pattern);
    if (!match) {
        throw new Error(`Failed to extract ${pattern}`);
    }
    return match[1];
}

function runNodeScript(filePath, options = {}) {
    return childProcess.execFileSync("node", [filePath], options).toString();
}

function registerExternalBytecodeKeys(vmSource) {
    const registrations = [...vmSource.matchAll(/registerBytecodeKey\('([^']+)',\s*'([^']+)'\)/g)];

    registrations.forEach(([, keyId, key]) => {
        JSVM.registerBytecodeKey(keyId, key);
    });

    return registrations;
}

function decodeEmbeddedBytecode(transpiledSource, vmSource) {
    const integrityKey = extractWrapperValue(/setBytecodeIntegrityKey\('([^']+)'\)/, transpiledSource);
    const protectedBytecode = extractWrapperValue(/loadFromString\('([^']+)',\s*'[^']+'\)/, transpiledSource);
    const encoding = extractWrapperValue(/loadFromString\('[^']+',\s*'([^']+)'\)/, transpiledSource);
    const vm = new JSVM();

    registerExternalBytecodeKeys(vmSource);
    vm.setBytecodeIntegrityKey(integrityKey);
    vm.loadFromString(protectedBytecode, encoding);

    return vm.code;
}

function extractVmOpNames(vmSource) {
    const match = vmSource.match(/const opNames = (\[[^;]+\])/s);
    if (!match) {
        throw new Error("Failed to extract VM opNames array");
    }
    return Function(`return ${match[1]};`)();
}

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

        const originalOutput = runNodeScript(sourcePath);
        const virtualizedOutput = runNodeScript(transpiledOutputPath);

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

        const originalOutput = runNodeScript(sourcePath);
        const virtualizedOutput = runNodeScript(transpiledOutputPath);

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

    test("externalizes whole-bytecode keys to the VM runtime output", async () => {
        const result = await transpile(`
// @virtualize
function demo() {
  return 42;
}

console.log(demo());
`, {
            fileName: "obfuscation-runtime-key.js",
            writeOutput: false,
            passes: ["RemoveUnused"]
        });

        const registrations = registerExternalBytecodeKeys(result.vm);

        expect(registrations.length).toBeGreaterThan(0);
        expect(result.vm).toContain("registerBytecodeKey");
        for (const [, keyId, key] of registrations) {
            expect(result.transpiled).not.toContain(key);
            expect(result.transpiled).toContain(keyId);
        }
        expect(result.transpiled).toContain("JSCX1:");
        expect(result.transpiled).toContain(":IJS:");
    });

    test("synthesizes macro opcodes for common opcode traces", async () => {
        const result = await transpile(`
// @virtualize
function demo(flag) {
  const left = 1;
  const right = 2;
  if (flag) {
    return left + right;
  }
  return right - left;
}

console.log(demo(true));
`, {
            fileName: "obfuscation-macros.js",
            writeOutput: false,
            passes: ["RemoveUnused"],
            controlFlowFlattening: false,
            opaquePredicates: false,
        });

        const opNames = extractVmOpNames(result.vm);

        expect(opNames.some((name) => name.startsWith("MACRO_"))).toBe(true);
    });

    test("dispatcher includes decoy handlers and runtime-derived alias slots", () => {
        const vm = new JSVM().setBytecodeIntegrityKey("dispatcher-probe");
        const aliasSlots = vm.dispatchLookup.filter((slots) => Array.isArray(slots) && slots.length > 1);
        const previousState = vm.runtimeOpcodeState;

        expect(vm.dispatchHandlers.length).toBeGreaterThan(vm.dispatchLookup.length);
        expect(vm.dispatchSlotKinds).toContain("decoy");
        expect(aliasSlots.length).toBeGreaterThan(0);

        vm.advanceRuntimeOpcodeState(7, 19);

        expect(vm.runtimeOpcodeState).not.toBe(previousState);
    });

    test("anti-debug sweep perturbs runtime state after suspicious pauses", () => {
        const vm = new JSVM().setBytecodeIntegrityKey("anti-debug-probe").enableAntiDebug("anti-debug-probe");
        const previousState = vm.runtimeOpcodeState;

        vm.antiDebugState.instructionCount = 8;
        vm.antiDebugState.lastStepAt = Date.now() - 5000;
        vm.runAntiDebugSweep(24);

        expect(vm.antiDebugState.suspicionScore).toBeGreaterThan(0);
        expect(vm.runtimeOpcodeState).not.toBe(previousState);
    });

    test("protects register storage and rotates wrappers on access", () => {
        const vm = new JSVM().enableMemoryProtection("memory-guard");
        const marker = {kind: "probe"};

        vm.write(7, marker);
        vm.write(8, "masked-value");
        const firstWrapper = vm.registers[8];

        expect(vm.registers[7]).not.toBe(marker);
        expect(vm.registers[8]).not.toBe("masked-value");
        expect(vm.read(7)).toBe(marker);
        expect(vm.read(8)).toBe("masked-value");
        expect(vm.registers[8]).not.toBe(firstWrapper);

        vm.registers[8] = firstWrapper;

        expect(() => vm.read(8)).toThrow("VM register protection token missing");

        vm.registers[8] = null;
        vm.write(8, "masked-value");
        vm.registers[8] = {
            ...vm.registers[8],
            guard: vm.registers[8].guard ^ 1
        };

        expect(() => vm.read(8)).toThrow("VM register protection check failed");
    });

    test("injects dead bytecode by default and allows disabling it", async () => {
        const source = `
// @virtualize
function demo() {
  return 42;
}

console.log(demo());
`;

        const withDeadCode = await transpile(source, {
            fileName: "dead-code-default.js",
            writeOutput: false,
            passes: ["RemoveUnused"]
        });

        const withoutDeadCode = await transpile(source, {
            fileName: "dead-code-disabled.js",
            writeOutput: false,
            passes: ["RemoveUnused"],
            deadCodeInjection: false
        });

        const defaultBytecode = decodeEmbeddedBytecode(withDeadCode.transpiled, withDeadCode.vm);
        const plainBytecode = decodeEmbeddedBytecode(withoutDeadCode.transpiled, withoutDeadCode.vm);

        expect(defaultBytecode.length).toBeGreaterThan(plainBytecode.length);
        expect(withDeadCode.transpiled).toContain("enableMemoryProtection");
    });
});
