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
        c2.append(new Opcode("LOAD_BYTE", 3, 42)); // 2
        c2.append(new Opcode("END")); // 1 => total 3, excl last 2? Actually 2 bytes before END => 2 +5 = 7
        const sizes = [c1, c2].map(c => {
            const sumExceptLast = c.code.slice(0, -1).reduce((s, op) => s + op.toBytes().length, 0);
            return sumExceptLast + 5;
        });
        expect(sizes).toEqual([17, 7]);
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
        const expected = (6+4+6)*2 + 1 + // preamble
                          (c1.code.length===1 ? 0 : 0) +5 + // c1 adjusted: if END is only, code without END is 0? Actually if only END, then body without last => no opcodes, jump 5
                          (c2.code.length===1 ? 0 : 0) +5 + // similarly
                          1; // final END
        // With single END each: adjusted size = 5, two funcs = 10, preamble = 33? Let's compute: selector check per func = 16, 2 funcs = 32, +1 = 33.
        expect(result.mergedChunk.code.length).toBe(33 + 10 + 1);
    });

    test("supports LE endian option", () => {
        const c = new VMChunk(); c.append(new Opcode("LOAD_DWORD", 1, encodeDWORD(0x12345678))); c.append(new Opcode("END"));
        const result = interleaveChunks([{ chunk: c }, { chunk: c }], 16, { polyEndian: "LE" });
        expect(result.mergedChunk).toBeInstanceOf(VMChunk);
    });
});
