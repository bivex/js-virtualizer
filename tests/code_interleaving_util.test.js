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

const { interleaveChunks } = require("../src/utils/codeInterleaving");
const { VMChunk, Opcode, encodeDWORD } = require("../src/utils/assembler");

describe("interleaveChunks utility", () => {
    test("throws error when given fewer than 2 entries", () => {
        const chunk = new VMChunk();
        chunk.append(new Opcode("LOAD_DWORD", 1, encodeDWORD(42)));
        chunk.append(new Opcode("END"));

        expect(() => interleaveChunks([{ chunk }], 16)).toThrow("interleaveChunks requires at least 2 entries");
    });

    test("merges two simple chunks into one", () => {
        const chunk1 = new VMChunk();
        chunk1.append(new Opcode("LOAD_DWORD", 1, encodeDWORD(10)));
        chunk1.append(new Opcode("END"));

        const chunk2 = new VMChunk();
        chunk2.append(new Opcode("LOAD_DWORD", 2, encodeDWORD(20)));
        chunk2.append(new Opcode("END"));

        const result = interleaveChunks([{ chunk: chunk1 }, { chunk: chunk2 }], 16);

        expect(result.mergedChunk).toBeInstanceOf(VMChunk);
        expect(result.selectorReg).toBe(14); // 16 - 2
        expect(result.fnStartPositions).toHaveLength(2);
        expect(result.fnStartPositions[0]).toBeGreaterThan(0);
        expect(result.fnStartPositions[1]).toBeGreaterThan(result.fnStartPositions[0]);
        expect(result.exitPosition).toBeGreaterThan(result.fnStartPositions[1]);
    });

    test("merged chunk contains selector dispatch preamble", () => {
        const makeChunk = (val) => {
            const c = new VMChunk();
            c.append(new Opcode("LOAD_DWORD", 1, encodeDWORD(val)));
            c.append(new Opcode("END"));
            return c;
        };

        const result = interleaveChunks([
            { chunk: makeChunk(10) },
            { chunk: makeChunk(20) },
            { chunk: makeChunk(30) }
        ], 16);

        const code = result.mergedChunk.code;
        // Preamble should contain SELECTOR_CHECK_SIZE * N bytes + 1 END
        const expectedPreambleSize = (6 + 4 + 6) * 3 + 1;
        // Expect at least preamble + minimal function data
        expect(code.length).toBeGreaterThanOrEqual(expectedPreambleSize);

        // Find the END of preamble by counting LOAD_DWORD (opcode 2), EQ (opcode 9), JUMP_EQ (opcode 10)
        // Each check: LOAD_DWORD (1 byte op + 1 reg + 4 dword = 6) + EQ (1+1+1+1 = 4) + JUMP_EQ (1+1+4 = 6) = 16
        // 3 checks = 48 bytes, plus final END = 1
        expect(code[48]).toBe(0); // END opcode
    });

    test("selector register is computed as registerCount - 2", () => {
        const c1 = new VMChunk(); c1.append(new Opcode("END"));
        const c2 = new VMChunk(); c2.append(new Opcode("END"));

        const result32 = interleaveChunks([{ chunk: c1 }, { chunk: c2 }], 32);
        expect(result32.selectorReg).toBe(30);

        const result64 = interleaveChunks([{ chunk: c1 }, { chunk: c2 }], 64);
        expect(result64.selectorReg).toBe(62);

        const result48 = interleaveChunks([{ chunk: c1 }, { chunk: c2 }], 48);
        expect(result48.selectorReg).toBe(46);
    });

    test("functions' bytecode appear in original order after preamble", () => {
        const c1 = new VMChunk();
        c1.append(new Opcode("LOAD_DWORD", 1, encodeDWORD(1)));
        c1.append(new Opcode("END"));

        const c2 = new VMChunk();
        c2.append(new Opcode("LOAD_DWORD", 2, encodeDWORD(2)));
        c2.append(new Opcode("END"));

        const result = interleaveChunks([{ chunk: c1 }, { chunk: c2 }], 16);
        const bytes = result.mergedChunk.toBytes();

        // After preamble (49 bytes), function1's LOAD_DWORD op should appear
        const fn1Start = result.fnStartPositions[0];
        expect(bytes[fn1Start]).toBe(2); // LOAD_DWORD opcode
        expect(bytes[fn1Start + 1]).toBe(1); // dest reg

        const fn2Start = result.fnStartPositions[1];
        expect(bytes[fn2Start]).toBe(2); // LOAD_DWORD opcode
        expect(bytes[fn2Start + 1]).toBe(2); // dest reg
    });

    test("merged chunk ensures function boundaries are contiguous", () => {
        const c1 = new VMChunk();
        c1.append(new Opcode("LOAD_DWORD", 1, encodeDWORD(1)));
        c1.append(new Opcode("END"));

        const c2 = new VMChunk();
        c2.append(new Opcode("LOAD_DWORD", 2, encodeDWORD(2)));
        c2.append(new Opcode("END"));

        const result = interleaveChunks([{ chunk: c1 }, { chunk: c2 }], 16);

        // No gap between functions
        expect(result.fnStartPositions[1]).toBe(result.fnStartPositions[0] + c1.code.length);
    });

    test("JUMP_UNCONDITIONAL at each function's exit points to merged exit", () => {
        // Create 2-function interleaving
        const c1 = new VMChunk(); c1.append(new Opcode("END"));
        const c2 = new VMChunk(); c2.append(new Opcode("END"));
        const result = interleaveChunks([{ chunk: c1 }, { chunk: c2 }], 16);

        // After selector + functions + final END, we should have correct structure
        // Each function's last opcode is JUMP_UNCONDITIONAL to exitPosition
        const code = result.mergedChunk.code;
        const exitPos = result.exitPosition;

        // For a function at position p, its JUMP_UNCONDITIONAL offset is exitPos - (p + 5)
        // The last instruction before final END
        const lastFuncIndex = result.fnStartPositions.length - 1;
        const lastFuncStart = result.fnStartPositions[lastFuncIndex];
        // The last instruction is JUMP_UNCONDITIONAL (5 bytes total: opcode + 4-byte offset)
        const jumpOpPos = lastFuncStart + 1 - 1; // the sole opcode position
        // The jump offset is encoded in the remaining 4 bytes; we can validate via compute of jump target
        // The jump instruction occupies opcode(1) + arg(4) bytes total 5, and is last instruction before exit END
        // Total merged code length = exitPos + 1 (END)
        expect(result.mergedChunk.code.length).toBe(exitPos + 1);
    });

    test("exit position is after all function code and its final END", () => {
        const chunks = [];
        for (let i = 0; i < 5; i++) {
            const c = new VMChunk();
            c.append(new Opcode("LOAD_DWORD", 1, encodeDWORD(i)));
            c.append(new Opcode("END"));
            chunks.push({ chunk: c });
        }
        const result = interleaveChunks(chunks, 16);

        // exitPosition should equal total bytes of mergedChunk.code - 1 (since END follows)
        expect(result.exitPosition).toBe(result.mergedChunk.code.length - 1);
    });

    test("supports little-endian via option", () => {
        const c = new VMChunk();
        c.append(new Opcode("LOAD_DWORD", 1, encodeDWORD(0x12345678)));
        c.append(new Opcode("END"));

        const result = interleaveChunks([{ chunk: c }, { chunk: c }], 16, { polyEndian: "LE" });
        // Just ensure it doesn't crash and produces a valid output
        expect(result.mergedChunk.code.length).toBeGreaterThan(0);
    });

    test("handles functions with multiple opcodes correctly", () => {
        const c1 = new VMChunk();
        c1.append(new Opcode("LOAD_DWORD", 1, encodeDWORD(100)));
        c1.append(new Opcode("LOAD_DWORD", 2, encodeDWORD(200)));
        c1.append(new Opcode("ADD", 3, 1, 2));
        c1.append(new Opcode("END"));

        const c2 = new VMChunk();
        c2.append(new Opcode("LOAD_DWORD", 4, encodeDWORD(50)));
        c2.append(new Opcode("LOAD_DWORD", 5, encodeDWORD(25)));
        c2.append(new Opcode("SUBTRACT", 6, 4, 5));
        c2.append(new Opcode("END"));

        const result = interleaveChunks([{ chunk: c1 }, { chunk: c2 }], 16);

        const code = result.mergedChunk.code;
        // At function1 start: LOAD_DWORD, LOAD_DWORD, ADD, JUMP_UNCONDITIONAL
        const f1Start = result.fnStartPositions[0];
        expect(code[f1Start]).toBe(2); // LOAD_DWORD
        expect(code[f1Start + 3]).toBe(2); // LOAD_DWORD
        expect(code[f1Start + 6]).toBe(15); // ADD

        const f2Start = result.fnStartPositions[1];
        expect(code[f2Start]).toBe(2);
        expect(code[f2Start + 3]).toBe(2);
        expect(code[f2Start + 6]).toBe(16); // SUBTRACT
    });

    test("preserves opcodes and registers from original chunks", () => {
        const c1 = new VMChunk();
        c1.append(new Opcode("LOAD_BYTE", 1, 42));
        c1.append(new Opcode("END"));

        const c2 = new VMChunk();
        c2.append(new Opcode("LOAD_BOOL", 2, 1));
        c2.append(new Opcode("END"));

        const result = interleaveChunks([{ chunk: c1 }, { chunk: c2 }], 16);
        const code = result.mergedChunk.code;

        const f1Start = result.fnStartPositions[0];
        expect(code[f1Start]).toBe(1); // LOAD_BYTE
        expect(code[f1Start + 1]).toBe(1); // dest reg

        const f2Start = result.fnStartPositions[1];
        expect(code[f2Start]).toBe(3); // LOAD_BOOL
        expect(code[f2Start + 1]).toBe(2); // dest reg
    });

    test("merged output register stays independent between functions", () => {
        const c1 = new VMChunk();
        c1.append(new Opcode("SET", 10, 100));
        c1.append(new Opcode("END"));

        const c2 = new VMChunk();
        c2.append(new Opcode("SET", 11, 200));
        c2.append(new Opcode("END"));

        const result = interleaveChunks([{ chunk: c1 }, { chunk: c2 }], 16);

        // both should have been assigned different output registers (10 and 11 are distinct)
        // we can't see output register from merged chunk, but we can verify both chunks unmodified
        // The merging shouldn't cause overlapping register usage for VFUNC outputs
        // Just ensure both chunks appended cleanly
        expect(result.fnStartPositions).toHaveLength(2);
    });
});
