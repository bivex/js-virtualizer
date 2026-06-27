'use strict';

const {spawnSync} = require('node:child_process');
const path = require('node:path');
const {transpile} = require('../src/transpile');

const {
    deriveOpaqueConstSeed,
    mask8,
    encryptChunkConstants,
    buildOpaqueConstantsPatch,
    applyOpaqueConstants,
} = require('../src/utils/opaqueConstants');

const {Opcode, encodeDWORD} = require('../src/utils/assembler');
const {VMChunk} = require('../src/utils/assembler');

const BASE_OPTS = {
    timeLock: false,
    writeOutput: true,
    outputDir: path.join(__dirname, '../output'),
    passes: new Set(['RemoveUnused']),
};

function run(filePath) {
    const r = spawnSync('node', [filePath], {encoding: 'utf-8', timeout: 15000});
    if (r.error) throw r.error;
    if (r.stderr && r.stderr.trim() && !r.stdout.trim()) {
        throw new Error('VM crash: ' + r.stderr.trim().split('\n')[0]);
    }
    return r.stdout.trim();
}

// ---------------------------------------------------------------------------
// Unit — deriveOpaqueConstSeed
// ---------------------------------------------------------------------------
describe('deriveOpaqueConstSeed', () => {
    test('different keys give different seeds', () => {
        expect(deriveOpaqueConstSeed('key-a')).not.toBe(deriveOpaqueConstSeed('key-b'));
    });
    test('same key gives same seed', () => {
        expect(deriveOpaqueConstSeed('stable')).toBe(deriveOpaqueConstSeed('stable'));
    });
    test('null/undefined handled', () => {
        expect(() => deriveOpaqueConstSeed(null)).not.toThrow();
        expect(() => deriveOpaqueConstSeed(undefined)).not.toThrow();
    });
    test('returns uint32', () => {
        const s = deriveOpaqueConstSeed('test');
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(0xFFFFFFFF);
    });
});

// ---------------------------------------------------------------------------
// Unit — mask8
// ---------------------------------------------------------------------------
describe('mask8', () => {
    test('returns value in 0..255', () => {
        for (let pos = 0; pos < 20; pos++) {
            const m = mask8(pos, 0xdeadbeef);
            expect(m).toBeGreaterThanOrEqual(0);
            expect(m).toBeLessThanOrEqual(255);
        }
    });
    test('different positions give different masks (generally)', () => {
        const masks = new Set();
        for (let pos = 0; pos < 32; pos++) masks.add(mask8(pos, 0xc0ffee));
        expect(masks.size).toBeGreaterThan(10);
    });
    test('XOR is self-inverse: mask(mask(v)) === v', () => {
        const seed = deriveOpaqueConstSeed('inv-test');
        for (let pos = 0; pos < 8; pos++) {
            const m = mask8(pos, seed);
            const v = 0xAB;
            expect((v ^ m) ^ m).toBe(v);
        }
    });
});

// ---------------------------------------------------------------------------
// Unit — encryptChunkConstants / VMChunk
// ---------------------------------------------------------------------------
describe('encryptChunkConstants', () => {
    test('LOAD_BYTE value byte is XOR-encrypted', () => {
        const {VMChunk} = require('../src/utils/assembler');
        const chunk = new VMChunk({});
        // LOAD_BYTE reg=5 value=42: opcode(1) + reg(1) + val(1) — pos of val = 2
        chunk.append(new Opcode('LOAD_BYTE', 5, 42));
        const seed = deriveOpaqueConstSeed('test-key');
        const origVal = chunk.code[0].data[1];
        encryptChunkConstants(chunk, seed);
        const encVal = chunk.code[0].data[1];
        expect(encVal).toBe(origVal ^ mask8(2, seed));
    });

    test('LOAD_DWORD value bytes are XOR-encrypted', () => {
        const {VMChunk} = require('../src/utils/assembler');
        const chunk = new VMChunk({});
        chunk.append(new Opcode('LOAD_DWORD', 3, encodeDWORD(0x12345678, 'BE')));
        const seed = deriveOpaqueConstSeed('dword-key');
        const origBytes = [...chunk.code[0].data.slice(1, 5)];
        encryptChunkConstants(chunk, seed);
        for (let i = 0; i < 4; i++) {
            expect(chunk.code[0].data[1 + i]).toBe(origBytes[i] ^ mask8(2 + i, seed));
        }
    });

    test('double encryption restores original', () => {
        const {VMChunk} = require('../src/utils/assembler');
        const chunk = new VMChunk({});
        chunk.append(new Opcode('LOAD_DWORD', 7, encodeDWORD(999, 'BE')));
        const seed = deriveOpaqueConstSeed('roundtrip');
        const origBytes = [...chunk.code[0].data];
        encryptChunkConstants(chunk, seed);
        encryptChunkConstants(chunk, seed); // double = restore
        expect([...chunk.code[0].data]).toEqual(origBytes);
    });

    test('non-LOAD opcodes are not touched', () => {
        const {VMChunk} = require('../src/utils/assembler');
        const chunk = new VMChunk({});
        chunk.append(new Opcode('NOP'));
        const seed = deriveOpaqueConstSeed('nop-key');
        const before = [...chunk.code[0].data];
        encryptChunkConstants(chunk, seed);
        expect([...chunk.code[0].data]).toEqual(before);
    });
});

// ---------------------------------------------------------------------------
// Unit — buildOpaqueConstantsPatch
// ---------------------------------------------------------------------------
describe('buildOpaqueConstantsPatch', () => {
    test('contains _oc_seed', () => {
        const p = buildOpaqueConstantsPatch(0xdeadbeef);
        expect(p).toContain('_oc_seed');
    });
    test('contains LOAD_BYTE and LOAD_DWORD replacements', () => {
        const p = buildOpaqueConstantsPatch(0x1234);
        expect(p).toContain('LOAD_BYTE');
        expect(p).toContain('LOAD_DWORD');
    });
    test('different seeds produce different patches', () => {
        expect(buildOpaqueConstantsPatch(1)).not.toBe(buildOpaqueConstantsPatch(2));
    });
});

// ---------------------------------------------------------------------------
// Unit — applyOpaqueConstants injection
// ---------------------------------------------------------------------------
describe('applyOpaqueConstants injection', () => {
    const FAKE_VM = `var implOpcode={};class JSVM {}\nif (typeof module !== 'undefined' && module.exports) { module.exports = JSVM }`;

    test('inserts patch after class JSVM', () => {
        const result = applyOpaqueConstants(FAKE_VM, 'inject-key');
        const pIdx = result.indexOf('_oc_seed');
        const cIdx = result.indexOf('class JSVM');
        expect(pIdx).toBeGreaterThan(cIdx);
    });

    test('patch before module.exports', () => {
        const result = applyOpaqueConstants(FAKE_VM, 'inject-key');
        const pIdx = result.indexOf('_oc_seed');
        const mIdx = result.indexOf('module.exports');
        expect(pIdx).toBeLessThan(mIdx);
    });

    test('different keys → different patches', () => {
        const r1 = applyOpaqueConstants(FAKE_VM, 'k1');
        const r2 = applyOpaqueConstants(FAKE_VM, 'k2');
        expect(r1).not.toBe(r2);
    });
});

// ---------------------------------------------------------------------------
// Integration
// ---------------------------------------------------------------------------
describe('transpile with opaqueConstants', () => {
    test('disabled: VM does not contain _oc_seed', async () => {
        const code = `// @virtualize\nfunction f(x){return x+1}\nconsole.log(f(0))`;
        const r = await transpile(code, {...BASE_OPTS, fileName: 'oc_off', opaqueConstants: false});
        expect(r.vm).not.toContain('_oc_seed');
    });

    test('enabled: VM contains _oc_seed and _oc_m', async () => {
        const code = `// @virtualize\nfunction f(x){return x+1}\nconsole.log(f(0))`;
        const r = await transpile(code, {...BASE_OPTS, fileName: 'oc_on', opaqueConstants: true});
        expect(r.vm).toContain('_oc_seed');
        expect(r.vm).toContain('_oc_m');
    });

    test('integer arithmetic', async () => {
        const code = `// @virtualize\nfunction f(a,b){return a+b}\nconsole.log(f(3,4))`;
        const r = await transpile(code, {...BASE_OPTS, fileName: 'oc_arith', opaqueConstants: true});
        expect(run(r.transpiledOutputPath)).toBe('7');
    });

    test('integer constant passthrough', async () => {
        const code = `// @virtualize\nfunction f(){return 42}\nconsole.log(f())`;
        const r = await transpile(code, {...BASE_OPTS, fileName: 'oc_const', opaqueConstants: true});
        expect(run(r.transpiledOutputPath)).toBe('42');
    });

    test('large constant (LOAD_DWORD range)', async () => {
        const code = `// @virtualize\nfunction f(){return 100000}\nconsole.log(f())`;
        const r = await transpile(code, {...BASE_OPTS, fileName: 'oc_large', opaqueConstants: true});
        expect(run(r.transpiledOutputPath)).toBe('100000');
    });

    test('counter loop', async () => {
        const code = `
// @virtualize
function sumTo(n){let s=0;for(let i=1;i<=n;i++)s+=i;return s;}
console.log(sumTo(10))`;
        const r = await transpile(code, {...BASE_OPTS, fileName: 'oc_loop', opaqueConstants: true});
        expect(run(r.transpiledOutputPath)).toBe('55');
    });

    test('string passthrough', async () => {
        const code = `// @virtualize\nfunction f(s){return s}\nconsole.log(f('hello'))`;
        const r = await transpile(code, {...BASE_OPTS, fileName: 'oc_str', opaqueConstants: true});
        expect(run(r.transpiledOutputPath)).toBe('hello');
    });

    test('combined: opaqueConstants + handlerObfuscation + stringEncryption', async () => {
        const code = `
// @virtualize
function classify(x){
    if(x>0)return 'pos';
    if(x<0)return 'neg';
    return 'zero';
}
console.log(classify(5));
console.log(classify(-3));
console.log(classify(0));`;
        const r = await transpile(code, {
            ...BASE_OPTS,
            fileName: 'oc_combo',
            opaqueConstants: true,
            handlerObfuscation: true,
            stringEncryption: true,
        });
        expect(run(r.transpiledOutputPath)).toBe('pos\nneg\nzero');
    });

    test('combined: all five protections', async () => {
        const code = `
// @virtualize
function fib(n){if(n<=1)return n;return fib(n-1)+fib(n-2);}
console.log(fib(10))`;
        const r = await transpile(code, {
            ...BASE_OPTS,
            fileName: 'oc_all',
            opaqueConstants: true,
            handlerObfuscation: true,
            stringEncryption: true,
            registerEncryption: true,
            integrityCheck: true,
        });
        expect(run(r.transpiledOutputPath)).toBe('55');
    });
});
