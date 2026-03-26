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
    encodeFloat,
    encodeArrayRegisters,
    encodeDWORD
} = require("../src/utils/assembler");

const randByte = Math.floor(Math.random() * 256);
const randInt = Math.floor(Math.random() * 100);
const randFloat = Math.random() * 100;
const randString = Math.random().toString(36).substring(2);

describe("loaders", () => {
    let VM;

    beforeAll(() => {
        VM = new JSVM();
        const chunk = new VMChunk();

        chunk.append(new Opcode("LOAD_BYTE", 3, randByte));
        chunk.append(new Opcode("LOAD_DWORD", 4, encodeDWORD(randInt)));
        chunk.append(new Opcode("LOAD_FLOAT", 5, encodeFloat(randFloat)));
        chunk.append(new Opcode("LOAD_STRING", 6, encodeString(randString)));
        chunk.append(new Opcode("LOAD_ARRAY", 7, encodeArrayRegisters([])));
        chunk.append(new Opcode("LOAD_ARRAY", 8, encodeArrayRegisters([3, 4, 5, 6, 7])));
        chunk.append(new Opcode("LOAD_ARRAY", 9, encodeArrayRegisters([8, 7])));
        chunk.append(new Opcode("LOAD_OBJECT", 10, encodeArrayRegisters([]), encodeArrayRegisters([])));
        chunk.append(new Opcode("LOAD_OBJECT", 11, encodeArrayRegisters([6]), encodeArrayRegisters([4])));
        chunk.append(new Opcode("LOAD_OBJECT", 12, encodeArrayRegisters([6]), encodeArrayRegisters([11])));

        const bytecode = chunk.toBytes().toString("base64");
        VM.loadFromString(bytecode, "base64");
        VM.run();
    });

    test("Load byte", () => {
        expect(VM.registers[3]).toBe(randByte);
    });

    test("Load dword", () => {
        expect(VM.registers[4]).toBe(randInt);
    });

    test("Load float", () => {
        expect(VM.registers[5]).toBe(randFloat);
    });

    test("Load string", () => {
        expect(VM.registers[6]).toBe(randString);
    });

    test("Load array (empty)", () => {
        expect(VM.registers[7]).toEqual([]);
    });

    test("Load array (with values)", () => {
        expect(VM.registers[8]).toEqual([randByte, randInt, randFloat, randString, []]);
    });

    test("Load array (nested)", () => {
        expect(VM.registers[9]).toEqual([[randByte, randInt, randFloat, randString, []], []]);
    });

    test("Load object (empty)", () => {
        expect(VM.registers[10]).toEqual({});
    });

    test("Load object (with values)", () => {
        expect(VM.registers[11]).toEqual({[randString]: randInt});
    });

    test("Load object (nested)", () => {
        expect(VM.registers[12]).toEqual({[randString]: {[randString]: randInt}});
    });
});
