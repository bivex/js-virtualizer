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

const JSVM = require("../src/vm_dev.js");
const {
    VMChunk,
    Opcode,
    encodeString,
    encodeDWORD
} = require("../src/utils/assembler");

const randInt1 = Math.floor(Math.random() * 100);
const randInt2 = Math.floor(Math.random() * 100);

describe("branching", () => {
    let VM;

    beforeAll(() => {
        VM = new JSVM();
        const chunk = new VMChunk();

        chunk.append(new Opcode("LOAD_DWORD", 3, encodeDWORD(randInt1)));
        chunk.append(new Opcode("LOAD_DWORD", 4, encodeDWORD(randInt2)));
        chunk.append(new Opcode("JUMP_UNCONDITIONAL", encodeDWORD(37)));
        chunk.append(new Opcode("LOAD_STRING", 5, encodeString("This should not be loaded!")));
        chunk.append(new Opcode("LOAD_STRING", 5, encodeString("This should be loaded!")));
        chunk.append(new Opcode("GREATER_THAN", 6, 3, 4));
        chunk.append(new Opcode("JUMP_EQ", 6, encodeDWORD(29)));
        chunk.append(new Opcode("LOAD_STRING", 7, encodeString("<= was true!")));
        chunk.append(new Opcode("JUMP_UNCONDITIONAL", encodeDWORD(22)));
        chunk.append(new Opcode("LOAD_STRING", 7, encodeString("> was true!")));
        chunk.append(new Opcode("JUMP_NOT_EQ", 6, encodeDWORD(28)));
        chunk.append(new Opcode("LOAD_STRING", 8, encodeString("> was true!")));
        chunk.append(new Opcode("JUMP_UNCONDITIONAL", encodeDWORD(23)));
        chunk.append(new Opcode("LOAD_STRING", 8, encodeString("<= was true!")));
        chunk.append(new Opcode("END"));

        const bytecode = chunk.toBytes().toString("base64");
        VM.loadFromString(bytecode, "base64");
        VM.run();
    });

    test("Unconditional Jump", () => {
        expect(VM.registers[5]).toBe("This should be loaded!");
    });

    test("Conditional Jump", () => {
        if (randInt1 > randInt2) {
            expect(VM.registers[7]).toBe("> was true!");
        } else {
            expect(VM.registers[7]).toBe("<= was true!");
        }
    });

    test("Conditional Jump (Negated)", () => {
        if (randInt1 <= randInt2) {
            expect(VM.registers[8]).toBe("<= was true!");
        } else {
            expect(VM.registers[8]).toBe("> was true!");
        }
    });
});
