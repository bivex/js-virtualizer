/**
 * Unit tests for interleaveChunks utility
 */

const { interleaveChunks } = require("../src/utils/codeInterleaving");
const { VMChunk, Opcode, encodeDWORD } = require("../src/utils/assembler");

describe("interleaveChunks utility", () => {
    test("throws error with fewer than 2 entries", () => {
        const chunk = new VMChunk();
        chunk.append(new Opcode("LOAD_DWORD", 1, encodeDWORD(42)));
        chunk.append(new Opcode("END"));
        expect(() => interleaveChunks([{ chunk }], 16)).toThrow("interleaveChunks requires at least 2 entries");
    });

    test("merges two chunks and computes correct selector register", () => {
        const c1 = new VMChunk(); c1.append(new Opcode("END"));
        const c2 = new VMChunk(); c2.append(new Opcode("END"));
        const result = interleaveChunks([{ chunk: c1 }, { chunk: c2 }], 16);
        expect(result.mergedChunk).toBeInstanceOf(VMChunk);
        expect(result.selectorReg).toBe(14); // 16 - 2
        expect(result.fnStartPositions).toHaveLength(2);
    });

    test("calculates adjusted function sizes correctly (excluding last opcode)", () => {
        const c1 = new VMChunk();
        c1.append(new Opcode("LOAD_DWORD", 1, encodeDWORD(1))); // 6 bytes
        c1.append(new Opcode("LOAD_DWORD", 2, encodeDWORD(2))); // 6
        c1.append(new Opcode("END")); // 1
        // total 13, exclude last (1) => 12, +5 jump => 17
        const c2 = new VMChunk();
        c2.append(new Opcode("LOAD_BYTE", 3, 42)); // 3 bytes (opcode + reg + byte)
        c2.append(new Opcode("END")); // 1 => total 4, excl last 3 => 3 +5 = 8
        const sizes = [c1, c2].map(c => {
            const sumExceptLast = c.code.slice(0, -1).reduce((s, op) => s + op.toBytes().length, 0);
            return sumExceptLast + 5;
        });
        expect(sizes).toEqual([17, 8]);
    });

    test("positions functions contiguously after preamble", () => {
        const c1 = new VMChunk(); c1.append(new Opcode("END"));
        const c2 = new VMChunk(); c2.append(new Opcode("END"));
        const result = interleaveChunks([{ chunk: c1 }, { chunk: c2 }], 16);
        expect(result.fnStartPositions[1]).toBe(result.fnStartPositions[0] + c1.code.slice(0,-1).reduce((s,op)=>s+op.toBytes().length,0) + 5);
    });

    test("total merged length is preamble + sum(adjusted sizes) + final END", () => {
        const c1 = new VMChunk(); c1.append(new Opcode("END"));
        const c2 = new VMChunk(); c2.append(new Opcode("END"));
        const result = interleaveChunks([{ chunk: c1 }, { chunk: c2 }], 16);
        // preamble: 3 opcodes (LOAD_DWORD+EQ+JUMP_EQ) * 2 funcs + 1 fallback END = 7 opcodes
        // each func body: only END stripped, replaced by JUMP_UNCONDITIONAL => 1 opcode each
        // exit END: 1 opcode
        // total = 7 + 1 + 1 + 1 = 10 opcodes
        expect(result.mergedChunk.code.length).toBe(10);
    });

    test("supports LE endian option", () => {
        const c = new VMChunk(); c.append(new Opcode("LOAD_DWORD", 1, encodeDWORD(0x12345678))); c.append(new Opcode("END"));
        const result = interleaveChunks([{ chunk: c }, { chunk: c }], 16, { polyEndian: "LE" });
        expect(result.mergedChunk).toBeInstanceOf(VMChunk);
    });
});
