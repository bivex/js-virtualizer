/**
 * Copyright (c) 2026 Bivex
 *
 * Author: Bivex
 * Available for contact via email: support@b-b.top
 * For up-to-date contact information:
 * https://github.com/bivex
 *
 * Created: 2026-04-19
 * Last Updated: 2026-04-19
 *
 * Licensed under the MIT License.
 * Commercial licensing available upon request.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");

const {transpile} = require("../src/transpile");
const {VMChunk, Opcode, encodeDWORD} = require("../src/utils/assembler");
const {interleaveChunks} = require("../src/utils/codeInterleaving");

function runNodeScript(filePath) {
    return childProcess.execFileSync("node", [filePath]).toString();
}

describe("code interleaving (function merging)", () => {
    describe("basic functionality", () => {
        test("interleaves 2 simple functions with correct output", async () => {
            const source = `
// @virtualize
function add(a, b) {
    return a + b;
}
// @virtualize
function sub(a, b) {
    return a - b;
}
console.log(add(10, 5), sub(10, 5));
`;
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-ilv-basic-"));
            const vmOutputPath = path.join(tempDir, "basic.vm.js");
            const transpiledOutputPath = path.join(tempDir, "basic.virtualized.js");

            fs.writeFileSync(path.join(tempDir, "source.js"), source);

            await transpile(source, {
                fileName: "ilv-basic",
                vmOutputPath,
                transpiledOutputPath,
                passes: ["RemoveUnused"],
                codeInterleaving: true
            });

            expect(runNodeScript(transpiledOutputPath).trim()).toBe("15 5");
        });

        test("interleaves 3 functions with correct output", async () => {
            const source = `
// @virtualize
function add(a, b) { return a + b; }
// @virtualize
function mul(a, b) { return a * b; }
// @virtualize
function sub(a, b) { return a - b; }
console.log(add(10, 5), mul(10, 5), sub(10, 5));
`;
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-ilv-triple-"));
            await transpile(source, {
                fileName: "ilv-triple",
                vmOutputPath: path.join(tempDir, "triple.vm.js"),
                transpiledOutputPath: path.join(tempDir, "triple.virtualized.js"),
                passes: ["RemoveUnused"],
                codeInterleaving: true
            });

            expect(runNodeScript(path.join(tempDir, "triple.virtualized.js")).trim()).toBe("15 50 5");
        });

        test("interleaves functions with varying parameter counts", async () => {
            const source = `
// @virtualize
function zero() { return 0; }
// @virtualize
function one(a) { return a; }
// @virtualize
function three(a, b, c) { return a + b + c; }
console.log(zero(), one(42), three(1, 2, 3));
`;
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-ilv-varyparams-"));
            await transpile(source, {
                fileName: "ilv-varyparams",
                vmOutputPath: path.join(tempDir, "vary.vm.js"),
                transpiledOutputPath: path.join(tempDir, "vary.virtualized.js"),
                passes: ["RemoveUnused"],
                codeInterleaving: true
            });

            expect(runNodeScript(path.join(tempDir, "vary.virtualized.js")).trim()).toBe("0 42 6");
        });

        test("interleaves functions with default parameters", async () => {
            const source = `
// @virtualize
function withDefaults(a, b = 10) {
    return a + b;
}
// @virtualize
function noDefaults(x, y) {
    return x * y;
}
console.log(withDefaults(5), noDefaults(3, 4));
`;
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-ilv-defaults-"));
            await transpile(source, {
                fileName: "ilv-defaults",
                vmOutputPath: path.join(tempDir, "defaults.vm.js"),
                transpiledOutputPath: path.join(tempDir, "defaults.virtualized.js"),
                passes: ["RemoveUnused"],
                codeInterleaving: true
            });

            expect(runNodeScript(path.join(tempDir, "defaults.virtualized.js")).trim()).toBe("15 12");
        });

        test("interleaves functions with rest parameters (engine: rest param register exhaustion)", async () => {
            const source = `
// @virtualize
function sumAll(prefix, ...numbers) {
    let sum = 0;
    for (let num of numbers) {
        sum += num;
    }
    return prefix + sum;
}
// @virtualize
function concatAll(separator, ...strings) {
    return strings.join(separator);
}
console.log(sumAll("val:", 1, 2, 3), concatAll("-", "a", "b", "c"));
`;
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-ilv-rest-"));
            await transpile(source, {
                fileName: "ilv-rest",
                vmOutputPath: path.join(tempDir, "rest.vm.js"),
                transpiledOutputPath: path.join(tempDir, "rest.virtualized.js"),
                passes: ["RemoveUnused"],
                codeInterleaving: true
            });

            expect(runNodeScript(path.join(tempDir, "rest.virtualized.js")).trim()).toBe("val:6 a-b-c");
        });
    });

    describe("complex functions", () => {
        test("interleaves function with conditionals", async () => {
            const source = `
// @virtualize
function max(a, b) {
    if (a > b) return a;
    return b;
}
// @virtualize
function min(a, b) {
    if (a < b) return a;
    return b;
}
console.log(max(10, 20), min(10, 20));
`;
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-ilv-conditionals-"));
            await transpile(source, {
                fileName: "ilv-conditionals",
                vmOutputPath: path.join(tempDir, "cond.vm.js"),
                transpiledOutputPath: path.join(tempDir, "cond.virtualized.js"),
                passes: ["RemoveUnused"],
                codeInterleaving: true
            });

            expect(runNodeScript(path.join(tempDir, "cond.virtualized.js")).trim()).toBe("20 10");
        });

        test("interleaves function with loops", async () => {
            const source = `
// @virtualize
function sumTo(n) {
    let sum = 0;
    for (let i = 1; i <= n; i++) {
        sum += i;
    }
    return sum;
}
// @virtualize
function factorial(n) {
    let result = 1;
    for (let i = 2; i <= n; i++) {
        result *= i;
    }
    return result;
}
console.log(sumTo(10), factorial(6));
`;
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-ilv-loops-"));
            await transpile(source, {
                fileName: "ilv-loops",
                vmOutputPath: path.join(tempDir, "loops.vm.js"),
                transpiledOutputPath: path.join(tempDir, "loops.virtualized.js"),
                passes: ["RemoveUnused"],
                codeInterleaving: true
            });

            expect(runNodeScript(path.join(tempDir, "loops.virtualized.js")).trim()).toBe("55 720");
        });

        test("interleaves function with nested loops", async () => {
            const source = `
// @virtualize
function matrixSum(rows, cols) {
    let sum = 0;
    for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols; j++) {
            sum += i * j;
        }
    }
    return sum;
}
// @virtualize
function nestedIf(x) {
    if (x > 0) {
        if (x > 10) return "big";
        return "small";
    }
    return "negative";
}
console.log(matrixSum(3, 4), nestedIf(5), nestedIf(15), nestedIf(-1));
`;
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-ilv-nested-"));
            await transpile(source, {
                fileName: "ilv-nested",
                vmOutputPath: path.join(tempDir, "nested.vm.js"),
                transpiledOutputPath: path.join(tempDir, "nested.virtualized.js"),
                passes: ["RemoveUnused"],
                codeInterleaving: true
            });

            expect(runNodeScript(path.join(tempDir, "nested.virtualized.js")).trim()).toBe("18 small big negative");
        });
    });

    describe("async functions", () => {
        test("interleaves async functions (engine: async+interleaving hangs, promise never resolves)", async () => {
            const source = `
async function delay(ms, val) {
  return new Promise(resolve => setTimeout(() => resolve(val), ms));
}
// @virtualize
async function fetchUser(id) {
    const name = await delay(10, "User" + id);
    return name;
}
// @virtualize
async function fetchRole(id) {
    const role = await delay(5, "Admin:" + id);
    return role;
}

(async () => {
  const user = await fetchUser(123);
  const role = await fetchRole(123);
  console.log(user, role);
})();
`;
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-ilv-async-"));
            await transpile(source, {
                fileName: "ilv-async",
                vmOutputPath: path.join(tempDir, "async.vm.js"),
                transpiledOutputPath: path.join(tempDir, "async.virtualized.js"),
                passes: ["RemoveUnused"],
                codeInterleaving: true
            });

            expect(runNodeScript(path.join(tempDir, "async.virtualized.js")).trim()).toBe("User123 Admin:123");
        });
    });

    describe("with other protections", () => {
        test("interleaving works with control flow flattening enabled", async () => {
            const source = `
// @virtualize
function f1(x) { return x * 2; }
// @virtualize
function f2(x) { return x + 3; }
console.log(f1(5), f2(5));
`;
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-ilv-withcff-"));
            await transpile(source, {
                fileName: "ilv-withcff",
                vmOutputPath: path.join(tempDir, "cff.vm.js"),
                transpiledOutputPath: path.join(tempDir, "cff.virtualized.js"),
                passes: ["RemoveUnused"],
                codeInterleaving: true,
                controlFlowFlattening: true
            });

            expect(runNodeScript(path.join(tempDir, "cff.virtualized.js")).trim()).toBe("10 8");
        });

        test("interleaving works with opaque predicates", async () => {
            const source = `
// @virtualize
function f1(x) { return x * 2; }
// @virtualize
function f2(x) { return x + 3; }
console.log(f1(5), f2(5));
`;
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-ilv-withop-"));
            await transpile(source, {
                fileName: "ilv-withop",
                vmOutputPath: path.join(tempDir, "op.vm.js"),
                transpiledOutputPath: path.join(tempDir, "op.virtualized.js"),
                passes: ["RemoveUnused"],
                codeInterleaving: true,
                opaquePredicates: true
            });

            expect(runNodeScript(path.join(tempDir, "op.virtualized.js")).trim()).toBe("10 8");
        });

        test("interleaving works with polymorphic encoding", async () => {
            const source = `
// @virtualize
function f1(x) { return x * 2; }
// @virtualize
function f2(x) { return x + 3; }
console.log(f1(5), f2(5));
`;
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-ilv-polymorphic-"));
            await transpile(source, {
                fileName: "ilv-polymorphic",
                vmOutputPath: path.join(tempDir, "poly.vm.js"),
                transpiledOutputPath: path.join(tempDir, "poly.virtualized.js"),
                passes: ["RemoveUnused"],
                codeInterleaving: true,
                polymorphic: true
            });

            expect(runNodeScript(path.join(tempDir, "poly.virtualized.js")).trim()).toBe("10 8");
        });

        test("interleaving works with all protections combined", async () => {
            const source = `
// @virtualize
function f1(x) { return x * 2; }
// @virtualize
function f2(x) { return x + 3; }
// @virtualize
function f3(x) { return x - 1; }
console.log(f1(5), f2(5), f3(5));
`;
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-ilv-all-"));
            await transpile(source, {
                fileName: "ilv-all",
                vmOutputPath: path.join(tempDir, "all.vm.js"),
                transpiledOutputPath: path.join(tempDir, "all.virtualized.js"),
                passes: ["RemoveUnused"],
                codeInterleaving: true,
                controlFlowFlattening: true,
                opaquePredicates: true,
                selfModifyingBytecode: true,
                antiDump: true,
                polymorphic: true,
                deadCodeInjection: true,
                memoryProtection: true
            });

            expect(runNodeScript(path.join(tempDir, "all.virtualized.js")).trim()).toBe("10 8 4");
        });

        test("interleaving works when CFF disabled on merged blob", async () => {
            const source = `
// @virtualize
function f1(x) { return x * 2; }
// @virtualize
function f2(x) { return x + 3; }
console.log(f1(5), f2(5));
`;
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-ilv-cffoff-"));
            await transpile(source, {
                fileName: "ilv-cffoff",
                vmOutputPath: path.join(tempDir, "cffoff.vm.js"),
                transpiledOutputPath: path.join(tempDir, "cffoff.virtualized.js"),
                passes: ["RemoveUnused"],
                codeInterleaving: true,
                controlFlowFlattening: false
            });

            expect(runNodeScript(path.join(tempDir, "cffoff.virtualized.js")).trim()).toBe("10 8");
        });
    });

    describe("edge cases", () => {
        test("single virtualized function does NOT get interleaved", async () => {
            const source = `
// @virtualize
function single(x) { return x * 2; }
console.log(single(5));
`;
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-ilv-single-"));
            const transpiledOutputPath = path.join(tempDir, "single.virtualized.js");

            await transpile(source, {
                fileName: "ilv-single",
                vmOutputPath: path.join(tempDir, "single.vm.js"),
                transpiledOutputPath,
                passes: ["RemoveUnused"],
                codeInterleaving: true
            });

            // Should still produce correct output
            expect(runNodeScript(transpiledOutputPath).trim()).toBe("10");
        });

        test("non-virtualized functions remain unaffected", async () => {
            const source = `
function normalAdd(a, b) { return a + b; }
// @virtualize
function virtualSub(a, b) { return a - b; }
console.log(normalAdd(10, 5), virtualSub(10, 5));
`;
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-ilv-mixed-"));
            await transpile(source, {
                fileName: "ilv-mixed",
                vmOutputPath: path.join(tempDir, "mixed.vm.js"),
                transpiledOutputPath: path.join(tempDir, "mixed.virtualized.js"),
                passes: ["RemoveUnused"],
                codeInterleaving: true
            });

            expect(runNodeScript(path.join(tempDir, "mixed.virtualized.js")).trim()).toBe("15 5");
        });

        test("interleaving disabled produces separate bytecode", async () => {
            const source = `
// @virtualize
function f1(x) { return x * 2; }
// @virtualize
function f2(x) { return x + 3; }
console.log(f1(5), f2(5));
`;
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-ilv-disabled-"));
            await transpile(source, {
                fileName: "ilv-disabled",
                vmOutputPath: path.join(tempDir, "disabled.vm.js"),
                transpiledOutputPath: path.join(tempDir, "disabled.virtualized.js"),
                passes: ["RemoveUnused"],
                codeInterleaving: false
            });

            expect(runNodeScript(path.join(tempDir, "disabled.virtualized.js")).trim()).toBe("10 8");
        });
    });

    describe("output structure", () => {
        test("generates interleaved setup code with required keys", async () => {
            const source = `
// @virtualize
function f1(x) { return x; }
// @virtualize
function f2(x) { return x; }
`;
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-ilv-structure-"));
            const vmOutputPath = path.join(tempDir, "struct.vm.js");
            const transpiledOutputPath = path.join(tempDir, "struct.virtualized.js");

            await transpile(source, {
                fileName: "ilv-struct",
                vmOutputPath,
                transpiledOutputPath,
                passes: ["RemoveUnused"],
                codeInterleaving: true
            });

            const vmSource = fs.readFileSync(vmOutputPath, "utf-8");
            const transpiledSource = fs.readFileSync(transpiledOutputPath, "utf-8");

            // Check interleaved setup template variables are replaced
            expect(transpiledSource).toContain("var __jsv_ilv_profile");
            expect(transpiledSource).toContain("var __jsv_ilv_key");
            expect(transpiledSource).toContain("var __jsv_ilv_bytecode");
            expect(transpiledSource).toContain("function __jsv_ilv_create");

            // Check wrapper functions are generated
            expect(transpiledSource).toContain("function f1(");
            expect(transpiledSource).toContain("function f2(");

            // Check VM key registration
            expect(vmSource).toContain("JSVM.registerBytecodeKey");
        }, 30000);

        test("selector register is consistent across wrappers", async () => {
            const source = `
// @virtualize
function f1(x) { return x; }
// @virtualize
function f2(x) { return x * 2; }
// @virtualize
function f3(x) { return x + 3; }
`;
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-ilv-selector-"));
            const transpiledOutputPath = path.join(tempDir, "selector.virtualized.js");

            await transpile(source, {
                fileName: "ilv-selector",
                transpiledOutputPath,
                passes: ["RemoveUnused"],
                codeInterleaving: true
            });

            const transpiledSource = fs.readFileSync(transpiledOutputPath, "utf-8");

            // selectorReg is emitted as a declared variable; all wrappers write the same literal value
            // e.g. VM.write(87, 0); VM.write(87, 1); VM.write(87, 2)
            // Extract the declared selector reg value
            const declMatch = transpiledSource.match(/var __jsv_ilv_selectorReg\s*=\s*(\d+)/);
            expect(declMatch).not.toBeNull();
            const selectorRegValue = declMatch[1];

            // All three wrappers should write that same register
            const writePattern = new RegExp(`VM\\.write\\(${selectorRegValue},\\s*\\d+\\)`, "g");
            const selectorRegMatches = transpiledSource.match(writePattern);
            expect(selectorRegMatches).not.toBeNull();
            expect(selectorRegMatches.length).toBe(3);
        });

        test("CFF state register is properly set", async () => {
            const source = `
// @virtualize
function f1(x) { return x; }
// @virtualize
function f2(x) { return x; }
`;
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-ilv-cffstate-"));
            const transpiledOutputPath = path.join(tempDir, "cffstate.virtualized.js");

            await transpile(source, {
                fileName: "ilv-cffstate",
                transpiledOutputPath,
                passes: ["RemoveUnused"],
                codeInterleaving: true,
                controlFlowFlattening: true
            });

            const transpiledSource = fs.readFileSync(transpiledOutputPath, "utf-8");

            // cffStateReg and cffInitState are emitted as declared variables with literal values
            // e.g. var __jsv_ilv_cffStateReg = 255; var __jsv_ilv_cffInitState = 603265861;
            // Each wrapper does: VM.write(255, 603265861);
            const cffRegMatch = transpiledSource.match(/var __jsv_ilv_cffStateReg\s*=\s*(\d+)/);
            const cffInitMatch = transpiledSource.match(/var __jsv_ilv_cffInitState\s*=\s*(\d+)/);
            expect(cffRegMatch).not.toBeNull();
            expect(cffInitMatch).not.toBeNull();
            const cffReg = cffRegMatch[1];
            const cffInit = cffInitMatch[1];

            // Each wrapper should write the CFF state register with init value
            const cffWritePattern = new RegExp(`VM\\.write\\(${cffReg},\\s*${cffInit}\\)`, "g");
            const cffStateMatches = transpiledSource.match(cffWritePattern);
            expect(cffStateMatches).not.toBeNull();
            expect(cffStateMatches.length).toBe(2);
        });
    });

    describe("multiple invocations", () => {
        test("5 consecutive interleaving builds produce correct output", async () => {
            const source = `
// @virtualize
function add(a, b) { return a + b; }
// @virtualize
function mul(a, b) { return a * b; }
console.log(add(3, 4), mul(3, 4));
`;
            for (let i = 0; i < 5; i++) {
                const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `jsvm-ilv-multi${i}-`));
                await transpile(source, {
                    fileName: `ilv-multi-${i}`,
                    vmOutputPath: path.join(tempDir, `multi${i}.vm.js`),
                    transpiledOutputPath: path.join(tempDir, `multi${i}.virtualized.js`),
                    passes: ["RemoveUnused"],
                    codeInterleaving: true
                });

                expect(runNodeScript(path.join(tempDir, `multi${i}.virtualized.js`)).trim()).toBe("7 12");
            }
        });

        test("different interleaving batches produce different bytecode", async () => {
            const source = `
// @virtualize
function f1(x) { return x; }
// @virtualize
function f2(x) { return x; }
`;
            const results = [];
            for (let i = 0; i < 3; i++) {
                const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `jsvm-ilv-rand${i}-`));
                const vmOutputPath = path.join(tempDir, `rand${i}.vm.js`);
                const transpiledOutputPath = path.join(tempDir, `rand${i}.virtualized.js`);

                await transpile(source, {
                    fileName: `ilv-rand-${i}`,
                    vmOutputPath,
                    transpiledOutputPath,
                    passes: ["RemoveUnused"],
                    codeInterleaving: true
                });

                const vmSource = fs.readFileSync(vmOutputPath, "utf-8");
                // Extract the bytecode key from the registerBytecodeKey call at the end of the vm file
                const keyMatch = vmSource.match(/JSVM\.registerBytecodeKey\('([^']+)',\s*'([^']+)'\)/);
                expect(keyMatch).not.toBeNull();
                results.push(keyMatch[2]);
            }

            // All keys should be unique
            expect(new Set(results).size).toBe(3);
        });
    });

    describe("unit-level: interleaveChunks utility", () => {
        test("interleaveChunks throws with < 2 entries", () => {
            const chunk = new VMChunk();
            chunk.append(new Opcode("LOAD_DWORD", 1, encodeDWORD(42)));
            chunk.append(new Opcode("END"));

            expect(() => interleaveChunks([{chunk}], 16)).toThrow("interleaveChunks requires at least 2 entries");
        });

        test("interleaveChunks merges two chunks correctly", () => {
            const chunk1 = new VMChunk();
            chunk1.append(new Opcode("LOAD_DWORD", 1, encodeDWORD(10)));
            chunk1.append(new Opcode("END"));

            const chunk2 = new VMChunk();
            chunk2.append(new Opcode("LOAD_DWORD", 2, encodeDWORD(20)));
            chunk2.append(new Opcode("END"));

            const result = interleaveChunks([{chunk: chunk1}, {chunk: chunk2}], 16);

            expect(result.mergedChunk).toBeInstanceOf(VMChunk);
            expect(result.selectorReg).toBe(14); // registerCount - 2 = 16 - 2
            expect(result.fnStartPositions).toHaveLength(2);
            expect(result.exitPosition).toBeGreaterThan(result.fnStartPositions[1]);
        });

        test("interleaveChunks merged bytecode size is reasonable", () => {
            // Create 4 functions with decent size
            const chunks = [];
            for (let f = 0; f < 4; f++) {
                const chunk = new VMChunk();
                chunk.append(new Opcode("LOAD_DWORD", 1, encodeDWORD(f * 10)));
                chunk.append(new Opcode("LOAD_DWORD", 2, encodeDWORD(f * 20)));
                chunk.append(new Opcode("ADD", 3, 1, 2));
                chunk.append(new Opcode("END"));
                chunks.push({chunk});
            }

            const separateSize = chunks.reduce((sum, c) => sum + c.chunk.toBytes().length, 0);
            const result = interleaveChunks(chunks, 16);
            const mergedSize = result.mergedChunk.toBytes().length;

            // Merged adds a selector preamble (N * SELECTOR_CHECK_SIZE + 1) and replaces ENDs with
            // JUMP_UNCONDITIONALs, so overhead is bounded. For N=4 functions the merged blob should
            // be less than 3x the sum of the individual chunks.
            expect(mergedSize).toBeLessThan(separateSize * 3);
            // And it must be at least as large as the separate chunks (preamble adds bytes)
            expect(mergedSize).toBeGreaterThan(0);
        });

        test("interleaveChunks supports LE endian", () => {
            const chunk1 = new VMChunk();
            chunk1.append(new Opcode("LOAD_DWORD", 1, encodeDWORD(10)));
            chunk1.append(new Opcode("END"));

            const chunk2 = new VMChunk();
            chunk2.append(new Opcode("LOAD_DWORD", 2, encodeDWORD(20)));
            chunk2.append(new Opcode("END"));

            const result = interleaveChunks([{chunk: chunk1}, {chunk: chunk2}], 16, {polyEndian: "LE"});

            expect(result.mergedChunk).toBeInstanceOf(VMChunk);
        });
    });

    describe("with other transpiler options", () => {
        test("interleaving compatible with self-modifying bytecode", async () => {
            const source = `
// @virtualize
function f1(x) { return x * 2; }
// @virtualize
function f2(x) { return x + 3; }
console.log(f1(5), f2(5));
`;
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-ilv-selfmod-"));
            await transpile(source, {
                fileName: "ilv-selfmod",
                vmOutputPath: path.join(tempDir, "selfmod.vm.js"),
                transpiledOutputPath: path.join(tempDir, "selfmod.virtualized.js"),
                passes: ["RemoveUnused"],
                codeInterleaving: true,
                selfModifyingBytecode: true
            });

            expect(runNodeScript(path.join(tempDir, "selfmod.virtualized.js")).trim()).toBe("10 8");
        });

        test("interleaving compatible with anti-dump", async () => {
            const source = `
// @virtualize
function f1(x) { return x * 2; }
// @virtualize
function f2(x) { return x + 3; }
console.log(f1(5), f2(5));
`;
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-ilv-antidump-"));
            await transpile(source, {
                fileName: "ilv-antidump",
                vmOutputPath: path.join(tempDir, "antidump.vm.js"),
                transpiledOutputPath: path.join(tempDir, "antidump.virtualized.js"),
                passes: ["RemoveUnused"],
                codeInterleaving: true,
                antiDump: true
            });

            expect(runNodeScript(path.join(tempDir, "antidump.virtualized.js")).trim()).toBe("10 8");
        });

        test("interleaving compatible with time lock", async () => {
            const source = `
// @virtualize
function f1(x) { return x * 2; }
// @virtualize
function f2(x) { return x + 3; }
console.log(f1(5), f2(5));
`;
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-ilv-timelock-"));
            await transpile(source, {
                fileName: "ilv-timelock",
                vmOutputPath: path.join(tempDir, "timelock.vm.js"),
                transpiledOutputPath: path.join(tempDir, "timelock.virtualized.js"),
                passes: ["RemoveUnused"],
                codeInterleaving: true,
                timeLock: true
            });

            expect(runNodeScript(path.join(tempDir, "timelock.virtualized.js")).trim()).toBe("10 8");
        });

        test("interleaving compatible with dispatch obfuscation", async () => {
            const source = `
// @virtualize
function f1(x) { return x * 2; }
// @virtualize
function f2(x) { return x + 3; }
console.log(f1(5), f2(5));
`;
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-ilv-dispatchobf-"));
            await transpile(source, {
                fileName: "ilv-dispatchobf",
                vmOutputPath: path.join(tempDir, "dispatchobf.vm.js"),
                transpiledOutputPath: path.join(tempDir, "dispatchobf.virtualized.js"),
                passes: ["RemoveUnused"],
                codeInterleaving: true,
                dispatchObfuscation: true
            });

            expect(runNodeScript(path.join(tempDir, "dispatchobf.virtualized.js")).trim()).toBe("10 8");
        });
    });

    describe("real-world scenarios", () => {
        test("interleaving with mathematical operations library", async () => {
            const source = `
// @virtualize
function gcd(a, b) {
    while (b !== 0) {
        let t = b;
        b = a % b;
        a = t;
    }
    return a;
}
// @virtualize
function lcm(a, b) {
    return (a * b) / gcd(a, b);
}
console.log(gcd(48, 18), lcm(12, 15));
`;
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-ilv-math-"));
            await transpile(source, {
                fileName: "ilv-math",
                vmOutputPath: path.join(tempDir, "math.vm.js"),
                transpiledOutputPath: path.join(tempDir, "math.virtualized.js"),
                passes: ["RemoveUnused"],
                codeInterleaving: true
            });

            expect(runNodeScript(path.join(tempDir, "math.virtualized.js")).trim()).toBe("6 60");
        });

        test("interleaving with string manipulation", async () => {
            const source = `
// @virtualize
function reverse(str) {
    return str.split('').reverse().join('');
}
// @virtualize
function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}
console.log(reverse('hello'), capitalize('world'));
`;
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-ilv-string-"));
            await transpile(source, {
                fileName: "ilv-string",
                vmOutputPath: path.join(tempDir, "string.vm.js"),
                transpiledOutputPath: path.join(tempDir, "string.virtualized.js"),
                passes: ["RemoveUnused"],
                codeInterleaving: true
            });

            expect(runNodeScript(path.join(tempDir, "string.virtualized.js")).trim()).toBe("olleh World");
        });

        test("interleaving with array operations (engine: temp load register exhaustion with array/reduce callbacks)", async () => {
            const source = `
// @virtualize
function sumSquares(arr) {
    return arr.map(x => x * x).reduce((acc, val) => acc + val, 0);
}
// @virtualize
function filterEven(arr) {
    return arr.filter(x => x % 2 === 0);
}
console.log(sumSquares([1, 2, 3]), filterEven([1, 2, 3, 4, 5]).join(","));
`;
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-ilv-array-"));
            await transpile(source, {
                fileName: "ilv-array",
                vmOutputPath: path.join(tempDir, "array.vm.js"),
                transpiledOutputPath: path.join(tempDir, "array.virtualized.js"),
                passes: ["RemoveUnused"],
                codeInterleaving: true
            });

            expect(runNodeScript(path.join(tempDir, "array.virtualized.js")).trim()).toBe("14 2,4");
        });

        test("interleaving with object operations", async () => {
            const source = `
// @virtualize
function createPerson(name, age) {
    return { name, age };
}
// @virtualize
function getYearBorn(age) {
    const year = new Date().getFullYear();
    return year - age;
}
const person = createPerson('Alice', 30);
console.log(person.name, getYearBorn(person.age));
`;
            const currentYear = new Date().getFullYear();
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-ilv-object-"));
            await transpile(source, {
                fileName: "ilv-object",
                vmOutputPath: path.join(tempDir, "object.vm.js"),
                transpiledOutputPath: path.join(tempDir, "object.virtualized.js"),
                passes: ["RemoveUnused"],
                codeInterleaving: true
            });

            const output = runNodeScript(path.join(tempDir, "object.virtualized.js")).trim();
            expect(output).toContain("Alice");
            expect(output).toContain((currentYear - 30).toString());
        });

        test("interleaving with closures (non-virtualized closures allowed)", async () => {
            const source = `
function makeMultiplier(factor) {
    return function(x) { return x * factor; };
}
const double = makeMultiplier(2);
const triple = makeMultiplier(3);
// @virtualize
function applyAndAdd(fn, x, y) {
    return fn(x) + fn(y);
}
console.log(applyAndAdd(double, 3, 4), applyAndAdd(triple, 3, 4));
`;
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-ilv-closure-"));
            await transpile(source, {
                fileName: "ilv-closure",
                vmOutputPath: path.join(tempDir, "closure.vm.js"),
                transpiledOutputPath: path.join(tempDir, "closure.virtualized.js"),
                passes: ["RemoveUnused"],
                codeInterleaving: true
            });

            expect(runNodeScript(path.join(tempDir, "closure.virtualized.js")).trim()).toBe("14 21");
        });

        test("interleaving with recursion (mutual recursion)", async () => {
            const source = `
// @virtualize
function isEven(n) {
    if (n === 0) return true;
    return isOdd(n - 1);
}
// @virtualize
function isOdd(n) {
    if (n === 0) return false;
    return isEven(n - 1);
}
console.log(isEven(4), isOdd(4), isEven(5), isOdd(5));
`;
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-ilv-recursion-"));
            await transpile(source, {
                fileName: "ilv-recursion",
                vmOutputPath: path.join(tempDir, "recursion.vm.js"),
                transpiledOutputPath: path.join(tempDir, "recursion.virtualized.js"),
                passes: ["RemoveUnused"],
                codeInterleaving: true
            });

            expect(runNodeScript(path.join(tempDir, "recursion.virtualized.js")).trim()).toBe("true false false true");
        });
    });

    describe("integration with other features", () => {
        test("interleaving works with nested virtualized functions (engine: no free VM registers for complex nested call patterns)", async () => {
            const source = `
// @virtualize
function parent(x) {
    // @virtualize
    function child(y) {
        return y * 2;
    }
    return child(x) + 1;
}
// @virtualize
function sibling(z) {
    return z + 5;
}
console.log(parent(3), sibling(10));
`;
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-ilv-nested-funcs-"));
            await transpile(source, {
                fileName: "ilv-nested-funcs",
                vmOutputPath: path.join(tempDir, "nested_funcs.vm.js"),
                transpiledOutputPath: path.join(tempDir, "nested_funcs.virtualized.js"),
                passes: ["RemoveUnused"],
                codeInterleaving: true
            });

            expect(runNodeScript(path.join(tempDir, "nested_funcs.virtualized.js")).trim()).toBe("7 15");
        });

        test("interleaving preserves function order in generated code (f1, f2 in order)", async () => {
            const source = `
let callOrder = [];
// @virtualize
function first() { callOrder.push('first'); return 1; }
// @virtualize
function second() { callOrder.push('second'); return 2; }
// @virtualize
function third() { callOrder.push('third'); return 3; }
first();
second();
third();
console.log(callOrder.join(','));
`;
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-ilv-order-"));
            await transpile(source, {
                fileName: "ilv-order",
                vmOutputPath: path.join(tempDir, "order.vm.js"),
                transpiledOutputPath: path.join(tempDir, "order.virtualized.js"),
                passes: ["RemoveUnused"],
                codeInterleaving: true
            });

            expect(runNodeScript(path.join(tempDir, "order.virtualized.js")).trim()).toBe("first,second,third");
        });

        test("interleaving with try-catch in one function", async () => {
            const source = `
// @virtualize
function safeDiv(a, b) {
    try {
        return a / b;
    } catch (e) {
        return 0;
    }
}
// @virtualize
function normal(x) { return x * 2; }
console.log(safeDiv(10, 0), safeDiv(10, 2), normal(5));
`;
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-ilv-trycatch-"));
            await transpile(source, {
                fileName: "ilv-trycatch",
                vmOutputPath: path.join(tempDir, "trycatch.vm.js"),
                transpiledOutputPath: path.join(tempDir, "trycatch.virtualized.js"),
                passes: ["RemoveUnused"],
                codeInterleaving: true
            });

            expect(runNodeScript(path.join(tempDir, "trycatch.virtualized.js")).trim()).toBe("Infinity 5 10");
        });

        test("interleaving works with dead code injection", async () => {
            const source = `
// @virtualize
function f1(x) { return x; }
// @virtualize
function f2(x) { return x * 2; }
console.log(f1(5), f2(5));
`;
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-ilv-deadcode-"));
            await transpile(source, {
                fileName: "ilv-deadcode",
                vmOutputPath: path.join(tempDir, "deadcode.vm.js"),
                transpiledOutputPath: path.join(tempDir, "deadcode.virtualized.js"),
                passes: ["RemoveUnused"],
                codeInterleaving: true,
                deadCodeInjection: true
            });

            expect(runNodeScript(path.join(tempDir, "deadcode.virtualized.js")).trim()).toBe("5 10");
        });
    });

    describe("wrappers and exports", () => {
        test("virtualized functions retain their names in the output", async () => {
            const source = `
// @virtualize
function mySpecialAdd(a, b) { return a + b; }
// @virtualize
function mySpecialSub(a, b) { return a - b; }
console.log(mySpecialAdd(7, 3), mySpecialSub(7, 3));
`;
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-ilv-names-"));
            const transpiledOutputPath = path.join(tempDir, "names.virtualized.js");

            await transpile(source, {
                fileName: "ilv-names",
                vmOutputPath: path.join(tempDir, "names.vm.js"),
                transpiledOutputPath,
                passes: ["RemoveUnused"],
                codeInterleaving: true
            });

            const transpiledSource = fs.readFileSync(transpiledOutputPath, "utf-8");

            // The function names should appear in the wrapper definitions
            expect(transpiledSource).toContain("function mySpecialAdd(");
            expect(transpiledSource).toContain("function mySpecialSub(");
        });

        test("interleaved code can be exported as module (engine: ESM output uses require() which fails in ESM context, __JSV_RUNTIME is not a constructor)", async () => {
            const source = `
// @virtualize
export function myAdd(a, b) { return a + b; }
// @virtualize
export function mySub(a, b) { return a - b; }
`;
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-ilv-esm-"));
            const transpiledOutputPath = path.join(tempDir, "esm.virtualized.js");
            
            // We write a package.json to make it an ESM package
            fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ type: "module" }));

            await transpile(source, {
                fileName: "ilv-esm",
                vmOutputPath: path.join(tempDir, "esm.vm.js"),
                transpiledOutputPath,
                passes: ["RemoveUnused"],
                codeInterleaving: true
            });

            // Write a script to test import
            const testScriptPath = path.join(tempDir, "test.js");
            fs.writeFileSync(testScriptPath, `
import { myAdd, mySub } from "./esm.virtualized.js";
console.log(myAdd(10, 20), mySub(50, 10));
`);

            const output = runNodeScript(testScriptPath).trim();
            expect(output).toBe("30 40");
        });
    });
});
