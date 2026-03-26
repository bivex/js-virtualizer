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
    encodeArrayRegisters,
    encodeDWORD
} = require("../src/utils/assembler");
const {registers} = require("../src/utils/constants");

const randInt = Math.floor(Math.random() * 100);

describe("virtual functions", () => {
    let VM;

    beforeAll(() => {
        VM = new JSVM();
        const chunk = new VMChunk();

        chunk.append(new Opcode("LOAD_DWORD", 3, encodeDWORD(randInt)));
        chunk.append(new Opcode("VFUNC_CALL", encodeDWORD(17), registers.VOID, encodeArrayRegisters([])));
        chunk.append(new Opcode("VFUNC_CALL", encodeDWORD(13), 4, encodeArrayRegisters([4, 3])));
        chunk.append(new Opcode("END"));
        chunk.append(new Opcode("VFUNC_RETURN", registers.VOID, encodeArrayRegisters([])));
        chunk.append(new Opcode("VFUNC_RETURN", 4, encodeArrayRegisters([])));

        const bytecode = chunk.toBytes(false).toString("base64");
        VM.loadFromString(bytecode, "base64");
        VM.run();
    });

    test("VOID VFUNC_CALL", () => {
        expect(VM.registers[registers.VOID]).toBe(0);
    });

    test("VFUNC_CALL (NO MUT)", () => {
        expect(VM.registers[4]).toBe(randInt);
    });
});
