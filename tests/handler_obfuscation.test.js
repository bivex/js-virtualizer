/**
 * Tests for Handler Semantics Obfuscation (handlerObfuscation option).
 *
 * Verifies:
 *  1. The feature is opt-in and does not change VM output when disabled.
 *  2. When enabled, the VM source contains the override IIFE patch.
 *  3. Virtualized code still produces correct results with obfuscated handlers.
 *  4. Each obfuscated arithmetic/comparison/bitwise handler is semantically correct.
 *  5. Different integrity keys produce different masks.
 *  6. The patch inserts itself between implOpcode and class JSVM.
 */

'use strict';

const path = require('node:path');
const fs = require('node:fs');
const {spawnSync} = require('node:child_process');

const {transpile} = require('../src/transpile');
const {
    generateObfuscatedHandlers,
    buildMasksFromKey,
    buildArithmeticMasks,
    applyHandlerObfuscation,
} = require('../src/utils/handlerObfuscation');

// ---------------------------------------------------------------------------
// Helper: run transpiled output and return stdout
// ---------------------------------------------------------------------------
function run(filePath) {
    const r = spawnSync('node', [filePath], {encoding: 'utf-8', timeout: 10000});
    if (r.error) throw r.error;
    return r.stdout.trim();
}

// ---------------------------------------------------------------------------
// Unit tests — mask / handler generators
// ---------------------------------------------------------------------------
describe('buildArithmeticMasks', () => {
    test('produces non-zero masks', () => {
        const masks = buildArithmeticMasks(0xdeadbeef);
        expect(masks.addK1).toBeGreaterThan(0);
        expect(masks.addK2).toBeGreaterThan(0);
        expect(masks.eqK1).not.toBe(masks.eqK2);
    });

    test('same seed → same masks', () => {
        const a = buildArithmeticMasks(12345678);
        const b = buildArithmeticMasks(12345678);
        expect(a).toEqual(b);
    });

    test('different seeds → different masks', () => {
        const a = buildArithmeticMasks(0x11111111);
        const b = buildArithmeticMasks(0x22222222);
        expect(a.addK1).not.toBe(b.addK1);
    });
});

describe('generateObfuscatedHandlers', () => {
    test('generates handler strings for all expected opcodes', () => {
        const handlers = generateObfuscatedHandlers('test-key-abc');
        const expected = [
            'ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'MODULO', 'POWER',
            'EQ', 'EQ_COERCE', 'NOT_EQ', 'NOT_EQ_COERCE',
            'LESS_THAN', 'LESS_THAN_EQ', 'GREATER_THAN', 'GREATER_THAN_EQ',
            'AND', 'OR', 'XOR', 'SHIFT_LEFT', 'SHIFT_RIGHT',
            'BNOT', 'NEGATE', 'TEST', 'TEST_NEQ',
        ];
        for (const name of expected) {
            expect(handlers[name]).toBeDefined();
            expect(typeof handlers[name]).toBe('string');
            expect(handlers[name]).toMatch(/^function\s*\(\)/);
        }
    });

    test('handler strings contain readByte and write calls', () => {
        const handlers = generateObfuscatedHandlers('integrity-key-xyz');
        expect(handlers.ADD).toContain('this.readByte()');
        expect(handlers.ADD).toContain('this.write(');
        expect(handlers.EQ).toContain('this.readByte()');
        expect(handlers.EQ).toContain('this.write(');
    });

    test('different keys → different handler bodies', () => {
        const h1 = generateObfuscatedHandlers('key-alpha');
        const h2 = generateObfuscatedHandlers('key-beta');
        expect(h1.ADD).not.toBe(h2.ADD);
        expect(h1.EQ).not.toBe(h2.EQ);
    });

    test('same key → same handler bodies (deterministic)', () => {
        const h1 = generateObfuscatedHandlers('stable-key-001');
        const h2 = generateObfuscatedHandlers('stable-key-001');
        expect(h1.ADD).toBe(h2.ADD);
        expect(h1.MULTIPLY).toBe(h2.MULTIPLY);
    });
});

// ---------------------------------------------------------------------------
// Unit tests — semantic correctness of generated handler functions
// (We eval the generated handler body in a mock VM context)
// ---------------------------------------------------------------------------
describe('obfuscated handler semantic correctness', () => {
    // Build a tiny mock VM context that mimics JSVM.read / readByte / write
    function makeMockVM(registerValues, bytecodeBytes) {
        let ip = 0;
        const regs = [...registerValues];
        const writes = {};
        return {
            readByte() { return bytecodeBytes[ip++]; },
            read(r) { return regs[r]; },
            write(r, v) { regs[r] = v; writes[r] = v; },
            _writes: writes,
            _regs: regs,
        };
    }

    function evalHandler(handlerStr, registers, bytecode) {
        // eslint-disable-next-line no-new-func
        const fn = new Function('return (' + handlerStr + ')')();
        const vm = makeMockVM(registers, bytecode);
        fn.call(vm);
        return vm._writes;
    }

    const handlers = generateObfuscatedHandlers('semantic-test-key');

    // bytecode: [destReg, leftReg, rightReg]
    // registers: [_, _, _, leftVal, rightVal, ...]   dest=0, left=3, right=4

    test('ADD: 7 + 5 = 12', () => {
        const w = evalHandler(handlers.ADD, [0, 0, 0, 7, 5], [0, 3, 4]);
        expect(w[0]).toBe(12);
    });

    test('ADD: negative numbers -3 + -4 = -7', () => {
        const w = evalHandler(handlers.ADD, [0, 0, 0, -3, -4], [0, 3, 4]);
        expect(w[0]).toBe(-7);
    });

    test('ADD: large numbers', () => {
        const w = evalHandler(handlers.ADD, [0, 0, 0, 100000, 200000], [0, 3, 4]);
        expect(w[0]).toBe(300000);
    });

    test('SUBTRACT: 10 - 3 = 7', () => {
        const w = evalHandler(handlers.SUBTRACT, [0, 0, 0, 10, 3], [0, 3, 4]);
        expect(w[0]).toBe(7);
    });

    test('SUBTRACT: 0 - 5 = -5', () => {
        const w = evalHandler(handlers.SUBTRACT, [0, 0, 0, 0, 5], [0, 3, 4]);
        expect(w[0]).toBe(-5);
    });

    test('MULTIPLY: 6 * 7 = 42', () => {
        const w = evalHandler(handlers.MULTIPLY, [0, 0, 0, 6, 7], [0, 3, 4]);
        expect(w[0]).toBe(42);
    });

    test('MULTIPLY: 0 * 999 = 0', () => {
        const w = evalHandler(handlers.MULTIPLY, [0, 0, 0, 0, 999], [0, 3, 4]);
        expect(w[0]).toBe(0);
    });

    test('DIVIDE: 20 / 4 = 5', () => {
        const w = evalHandler(handlers.DIVIDE, [0, 0, 0, 20, 4], [0, 3, 4]);
        expect(w[0]).toBe(5);
    });

    test('MODULO: 17 % 5 = 2', () => {
        const w = evalHandler(handlers.MODULO, [0, 0, 0, 17, 5], [0, 3, 4]);
        expect(w[0]).toBe(2);
    });

    test('POWER: 2 ** 10 = 1024', () => {
        const w = evalHandler(handlers.POWER, [0, 0, 0, 2, 10], [0, 3, 4]);
        expect(w[0]).toBe(1024);
    });

    test('EQ: 5 === 5 → true', () => {
        const w = evalHandler(handlers.EQ, [0, 0, 0, 5, 5], [0, 3, 4]);
        expect(w[0]).toBe(true);
    });

    test('EQ: 5 === 6 → false', () => {
        const w = evalHandler(handlers.EQ, [0, 0, 0, 5, 6], [0, 3, 4]);
        expect(w[0]).toBe(false);
    });

    test('NOT_EQ: 5 !== 6 → true', () => {
        const w = evalHandler(handlers.NOT_EQ, [0, 0, 0, 5, 6], [0, 3, 4]);
        expect(w[0]).toBe(true);
    });

    test('NOT_EQ: 5 !== 5 → false', () => {
        const w = evalHandler(handlers.NOT_EQ, [0, 0, 0, 5, 5], [0, 3, 4]);
        expect(w[0]).toBe(false);
    });

    test('LESS_THAN: 3 < 7 → true', () => {
        const w = evalHandler(handlers.LESS_THAN, [0, 0, 0, 3, 7], [0, 3, 4]);
        expect(w[0]).toBe(true);
    });

    test('LESS_THAN: 7 < 3 → false', () => {
        const w = evalHandler(handlers.LESS_THAN, [0, 0, 0, 7, 3], [0, 3, 4]);
        expect(w[0]).toBe(false);
    });

    test('LESS_THAN_EQ: 5 <= 5 → true', () => {
        const w = evalHandler(handlers.LESS_THAN_EQ, [0, 0, 0, 5, 5], [0, 3, 4]);
        expect(w[0]).toBe(true);
    });

    test('GREATER_THAN: 9 > 4 → true', () => {
        const w = evalHandler(handlers.GREATER_THAN, [0, 0, 0, 9, 4], [0, 3, 4]);
        expect(w[0]).toBe(true);
    });

    test('GREATER_THAN_EQ: 4 >= 4 → true', () => {
        const w = evalHandler(handlers.GREATER_THAN_EQ, [0, 0, 0, 4, 4], [0, 3, 4]);
        expect(w[0]).toBe(true);
    });

    test('AND: 0b1100 & 0b1010 = 0b1000', () => {
        const w = evalHandler(handlers.AND, [0, 0, 0, 0b1100, 0b1010], [0, 3, 4]);
        expect(w[0]).toBe(0b1000);
    });

    test('OR: 0b1100 | 0b1010 = 0b1110', () => {
        const w = evalHandler(handlers.OR, [0, 0, 0, 0b1100, 0b1010], [0, 3, 4]);
        expect(w[0]).toBe(0b1110);
    });

    test('XOR: 0b1100 ^ 0b1010 = 0b0110', () => {
        const w = evalHandler(handlers.XOR, [0, 0, 0, 0b1100, 0b1010], [0, 3, 4]);
        expect(w[0]).toBe(0b0110);
    });

    test('BNOT: ~5 = -6', () => {
        // bytecode: [dest, src]
        const w = evalHandler(handlers.BNOT, [0, 0, 0, 5], [0, 3]);
        expect(w[0]).toBe(~5);
    });

    test('NEGATE: -(-7) = 7', () => {
        const w = evalHandler(handlers.NEGATE, [0, 0, 0, -7], [0, 3]);
        expect(w[0]).toBeCloseTo(7);
    });

    test('TEST: truthy value → true', () => {
        const w = evalHandler(handlers.TEST, [0, 0, 0, 42], [0, 3]);
        expect(w[0]).toBe(true);
    });

    test('TEST: falsy value → false', () => {
        const w = evalHandler(handlers.TEST, [0, 0, 0, 0], [0, 3]);
        expect(w[0]).toBe(false);
    });

    test('TEST_NEQ: falsy → true', () => {
        const w = evalHandler(handlers.TEST_NEQ, [0, 0, 0, 0], [0, 3]);
        expect(w[0]).toBe(true);
    });

    test('TEST_NEQ: truthy → false', () => {
        const w = evalHandler(handlers.TEST_NEQ, [0, 0, 0, 1], [0, 3]);
        expect(w[0]).toBe(false);
    });

    // SHIFT — bytecode: [dest, src, shift]
    test('SHIFT_LEFT: 1 << 3 = 8', () => {
        const w = evalHandler(handlers.SHIFT_LEFT, [0, 0, 0, 1, 3], [0, 3, 4]);
        expect(w[0]).toBe(8);
    });

    test('SHIFT_RIGHT: 16 >> 2 = 4', () => {
        const w = evalHandler(handlers.SHIFT_RIGHT, [0, 0, 0, 16, 2], [0, 3, 4]);
        expect(w[0]).toBe(4);
    });
});

// ---------------------------------------------------------------------------
// applyHandlerObfuscation — string injection tests
// ---------------------------------------------------------------------------
describe('applyHandlerObfuscation string injection', () => {
    const FAKE_VM = `const implOpcode = { ADD: function(){} };\n\nclass JSVM {}\nmodule.exports = JSVM`;

    test('injects patch between implOpcode and class JSVM', () => {
        const result = applyHandlerObfuscation(FAKE_VM, 'inject-test-key');
        const implIdx = result.indexOf('const implOpcode');
        const patchIdx = result.indexOf('(function(_i)');
        const classIdx = result.indexOf('class JSVM');
        expect(implIdx).toBeLessThan(patchIdx);
        expect(patchIdx).toBeLessThan(classIdx);
    });

    test('patch contains override for ADD', () => {
        const result = applyHandlerObfuscation(FAKE_VM, 'inject-test-key');
        expect(result).toContain('_i.ADD=');
    });

    test('patch contains override for EQ', () => {
        const result = applyHandlerObfuscation(FAKE_VM, 'inject-test-key');
        expect(result).toContain('_i.EQ=');
    });

    test('different keys produce different patches', () => {
        const r1 = applyHandlerObfuscation(FAKE_VM, 'key-one');
        const r2 = applyHandlerObfuscation(FAKE_VM, 'key-two');
        const extractPatch = s => {
            const start = s.indexOf('(function(_i)');
            const end = s.indexOf('class JSVM');
            return s.slice(start, end);
        };
        expect(extractPatch(r1)).not.toBe(extractPatch(r2));
    });

    test('fallback: inserts before module.exports when no class JSVM marker', () => {
        const noClass = `const implOpcode = {};\nmodule.exports = JSVM`;
        const result = applyHandlerObfuscation(noClass, 'fallback-key');
        const patchIdx = result.indexOf('(function(_i)');
        const exportIdx = result.indexOf('module.exports');
        expect(patchIdx).toBeLessThan(exportIdx);
    });
});

// ---------------------------------------------------------------------------
// Integration tests — transpile with handlerObfuscation: true
// ---------------------------------------------------------------------------
describe('transpile with handlerObfuscation', () => {
    const passes = ['RemoveUnused'];
    const baseOpts = { passes, timeLock: false };

    test('disabled by default: VM source does not contain handler override IIFE', async () => {
        const code = `// @virtualize\nfunction add(a,b){return a+b}\nconsole.log(add(2,3))`;
        const result = await transpile(code, {
            ...baseOpts,
            fileName: 'hob_disabled',
            handlerObfuscation: false,
        });
        expect(result.vm).not.toContain('(function(_i)');
    });

    test('enabled: VM source contains handler override IIFE', async () => {
        const code = `// @virtualize\nfunction add(a,b){return a+b}\nconsole.log(add(2,3))`;
        const result = await transpile(code, {
            ...baseOpts,
            fileName: 'hob_enabled',
            handlerObfuscation: true,
        });
        expect(result.vm).toContain('(function(_i)');
        expect(result.vm).toContain('_i.ADD=');
    });

    test('ADD: 2 + 3 = 5 with obfuscated handlers', async () => {
        const code = `// @virtualize\nfunction add(a,b){return a+b}\nconsole.log(add(2,3))`;
        const result = await transpile(code, {
            ...baseOpts,
            fileName: 'hob_add',
            handlerObfuscation: true,
        });
        expect(run(result.transpiledOutputPath)).toBe('5');
    });

    test('arithmetic: subtract, multiply, modulo', async () => {
        const code = `
// @virtualize
function calc(a, b) {
    const s = a - b;
    const m = a * b;
    const r = a % b;
    return s + ',' + m + ',' + r;
}
console.log(calc(10, 3))`;
        const result = await transpile(code, {
            ...baseOpts,
            fileName: 'hob_arith',
            handlerObfuscation: true,
        });
        expect(run(result.transpiledOutputPath)).toBe('7,30,1');
    });

    test('comparisons: eq, lt, gt', async () => {
        const code = `
// @virtualize
function cmp(a, b) {
    return [a === b, a < b, a > b].join(',');
}
console.log(cmp(5, 10))`;
        const result = await transpile(code, {
            ...baseOpts,
            fileName: 'hob_cmp',
            handlerObfuscation: true,
        });
        expect(run(result.transpiledOutputPath)).toBe('false,true,false');
    });

    test('bitwise: AND, OR, XOR', async () => {
        const code = `
// @virtualize
function bits(a, b) {
    return [(a & b), (a | b), (a ^ b)].join(',');
}
console.log(bits(0b1100, 0b1010))`;
        const result = await transpile(code, {
            ...baseOpts,
            fileName: 'hob_bits',
            handlerObfuscation: true,
        });
        expect(run(result.transpiledOutputPath)).toBe('8,14,6');
    });

    test('loop with counter — exercises ADD + LESS_THAN', async () => {
        const code = `
// @virtualize
function sumTo(n) {
    let s = 0;
    for (let i = 1; i <= n; i++) s += i;
    return s;
}
console.log(sumTo(10))`;
        const result = await transpile(code, {
            ...baseOpts,
            fileName: 'hob_loop',
            handlerObfuscation: true,
        });
        expect(run(result.transpiledOutputPath)).toBe('55');
    });

    test('string concat (ADD with non-numeric operands)', async () => {
        const code = `
// @virtualize
function greet(name) {
    return 'Hello, ' + name + '!';
}
console.log(greet('World'))`;
        const result = await transpile(code, {
            ...baseOpts,
            fileName: 'hob_str',
            handlerObfuscation: true,
        });
        expect(run(result.transpiledOutputPath)).toBe('Hello, World!');
    });

    test('combined with nestedVM', async () => {
        const code = `
// @virtualize
function compute(x) {
    return x * x + x;
}
console.log(compute(4))`;
        const result = await transpile(code, {
            ...baseOpts,
            fileName: 'hob_nested',
            handlerObfuscation: true,
            nestedVM: true,
        });
        expect(result.vm).toContain('InnerVM');
        expect(result.vm).toContain('(function(_i)');
        expect(run(result.transpiledOutputPath)).toBe('20');
    });

    test('combined with CFF + opaque predicates', async () => {
        const code = `
// @virtualize
function classify(n) {
    if (n < 0) return 'neg';
    if (n === 0) return 'zero';
    return 'pos';
}
console.log(classify(-1));
console.log(classify(0));
console.log(classify(5));`;
        const result = await transpile(code, {
            ...baseOpts,
            fileName: 'hob_cff',
            handlerObfuscation: true,
            controlFlowFlattening: true,
            opaquePredicates: true,
        });
        const out = run(result.transpiledOutputPath);
        expect(out).toBe('neg\nzero\npos');
    });

    test('patch is inserted before class JSVM in generated VM', async () => {
        const code = `// @virtualize\nfunction f(a){return a+1}\nconsole.log(f(0))`;
        const result = await transpile(code, {
            ...baseOpts,
            fileName: 'hob_position',
            handlerObfuscation: true,
        });
        const vm = result.vm;
        const patchIdx = vm.indexOf('(function(_i)');
        const classIdx = vm.indexOf('class JSVM');
        expect(patchIdx).toBeGreaterThan(-1);
        expect(classIdx).toBeGreaterThan(-1);
        expect(patchIdx).toBeLessThan(classIdx);
    });
});
