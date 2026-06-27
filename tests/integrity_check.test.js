'use strict';

const {spawnSync} = require('node:child_process');
const path = require('node:path');
const {transpile} = require('../src/transpile');

const {
    fnv1a,
    deriveTweak,
    buildIntegrityCheckPatch,
    applyIntegrityCheck,
    GUARDED_METHODS,
} = require('../src/utils/integrityCheck');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
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
// Unit — fnv1a
// ---------------------------------------------------------------------------
describe('fnv1a', () => {
    test('empty string gives FNV offset basis', () => {
        expect(fnv1a('')).toBe(0x811c9dc5);
    });
    test('different strings give different hashes', () => {
        expect(fnv1a('hello')).not.toBe(fnv1a('world'));
    });
    test('same string always gives same hash', () => {
        expect(fnv1a('test-string')).toBe(fnv1a('test-string'));
    });
    test('returns uint32', () => {
        const h = fnv1a('abc');
        expect(h).toBeGreaterThanOrEqual(0);
        expect(h).toBeLessThanOrEqual(0xFFFFFFFF);
    });
});

// ---------------------------------------------------------------------------
// Unit — deriveTweak
// ---------------------------------------------------------------------------
describe('deriveTweak', () => {
    test('different keys give different tweaks', () => {
        expect(deriveTweak('key-a')).not.toBe(deriveTweak('key-b'));
    });
    test('same key always same tweak', () => {
        expect(deriveTweak('stable')).toBe(deriveTweak('stable'));
    });
    test('null/undefined handled without throwing', () => {
        expect(() => deriveTweak(null)).not.toThrow();
        expect(() => deriveTweak(undefined)).not.toThrow();
    });
    test('returns uint32', () => {
        const t = deriveTweak('mykey');
        expect(t).toBeGreaterThanOrEqual(0);
        expect(t).toBeLessThanOrEqual(0xFFFFFFFF);
    });
});

// ---------------------------------------------------------------------------
// Unit — buildIntegrityCheckPatch
// ---------------------------------------------------------------------------
describe('buildIntegrityCheckPatch', () => {
    test('contains _ic_check function', () => {
        const p = buildIntegrityCheckPatch('test-key');
        expect(p).toContain('_ic_check');
    });
    test('contains _ic_expected table', () => {
        const p = buildIntegrityCheckPatch('test-key');
        expect(p).toContain('_ic_expected');
    });
    test('wraps run and runAsync', () => {
        const p = buildIntegrityCheckPatch('test-key');
        expect(p).toContain('prototype.run');
        expect(p).toContain('prototype.runAsync');
    });
    test('different keys produce different patches', () => {
        const p1 = buildIntegrityCheckPatch('key-one');
        const p2 = buildIntegrityCheckPatch('key-two');
        expect(p1).not.toBe(p2);
    });
    test('tweak value embedded in patch', () => {
        const tweak = deriveTweak('embed-key');
        const p = buildIntegrityCheckPatch('embed-key');
        expect(p).toContain(String(tweak));
    });
});

// ---------------------------------------------------------------------------
// Unit — GUARDED_METHODS list
// ---------------------------------------------------------------------------
describe('GUARDED_METHODS', () => {
    test('contains critical methods', () => {
        expect(GUARDED_METHODS).toContain('write');
        expect(GUARDED_METHODS).toContain('readStored');
        expect(GUARDED_METHODS).toContain('read');
        expect(GUARDED_METHODS).toContain('readString');
        expect(GUARDED_METHODS).toContain('run');
    });
});

// ---------------------------------------------------------------------------
// Unit — applyIntegrityCheck injection
// ---------------------------------------------------------------------------
describe('applyIntegrityCheck injection', () => {
    const FAKE_VM = `class JSVM {}\nif (typeof module !== 'undefined' && module.exports) { module.exports = JSVM }`;

    test('inserts patch after class JSVM', () => {
        const result = applyIntegrityCheck(FAKE_VM, 'inject-key');
        const pIdx = result.indexOf('_ic_check');
        const cIdx = result.indexOf('class JSVM');
        expect(pIdx).toBeGreaterThan(-1);
        expect(pIdx).toBeGreaterThan(cIdx);
    });

    test('patch appears before module.exports', () => {
        const result = applyIntegrityCheck(FAKE_VM, 'inject-key');
        const pIdx = result.indexOf('_ic_check');
        const mIdx = result.indexOf('module.exports');
        expect(pIdx).toBeLessThan(mIdx);
    });

    test('different keys → different injected tweak', () => {
        const r1 = applyIntegrityCheck(FAKE_VM, 'k1');
        const r2 = applyIntegrityCheck(FAKE_VM, 'k2');
        expect(r1).not.toBe(r2);
    });
});

// ---------------------------------------------------------------------------
// Integration — disabled: no _ic_check in VM
// ---------------------------------------------------------------------------
describe('transpile with integrityCheck', () => {
    test('disabled: VM does not contain _ic_check', async () => {
        const code = `// @virtualize\nfunction f(x){return x+1}\nconsole.log(f(0))`;
        const r = await transpile(code, {...BASE_OPTS, fileName: 'ic_off', integrityCheck: false});
        expect(r.vm).not.toContain('_ic_check');
    });

    test('enabled: VM contains _ic_check and _ic_expected', async () => {
        const code = `// @virtualize\nfunction f(x){return x+1}\nconsole.log(f(0))`;
        const r = await transpile(code, {...BASE_OPTS, fileName: 'ic_on', integrityCheck: true});
        expect(r.vm).toContain('_ic_check');
        expect(r.vm).toContain('_ic_expected');
    });

    test('enabled: patch inserted after class JSVM', async () => {
        const code = `// @virtualize\nfunction f(x){return x+1}\nconsole.log(f(0))`;
        const r = await transpile(code, {...BASE_OPTS, fileName: 'ic_pos', integrityCheck: true});
        const pIdx = r.vm.indexOf('_ic_check');
        const cIdx = r.vm.indexOf('class JSVM');
        expect(pIdx).toBeGreaterThan(cIdx);
    });

    test('enabled: normal execution works', async () => {
        const code = `// @virtualize\nfunction f(a,b){return a+b}\nconsole.log(f(3,4))`;
        const r = await transpile(code, {...BASE_OPTS, fileName: 'ic_run', integrityCheck: true});
        expect(run(r.transpiledOutputPath)).toBe('7');
    });

    test('enabled: string passthrough works', async () => {
        const code = `// @virtualize\nfunction f(s){return s}\nconsole.log(f('hello'))`;
        const r = await transpile(code, {...BASE_OPTS, fileName: 'ic_str', integrityCheck: true});
        expect(run(r.transpiledOutputPath)).toBe('hello');
    });

    test('enabled: loop works', async () => {
        const code = `
// @virtualize
function sumTo(n){let s=0;for(let i=1;i<=n;i++)s+=i;return s;}
console.log(sumTo(10))`;
        const r = await transpile(code, {...BASE_OPTS, fileName: 'ic_loop', integrityCheck: true});
        expect(run(r.transpiledOutputPath)).toBe('55');
    });

    test('tamper detection: patching write throws on run()', async () => {
        const code = `// @virtualize\nfunction f(x){return x+1}\nconsole.log(f(0))`;
        const r = await transpile(code, {...BASE_OPTS, fileName: 'ic_tamper', integrityCheck: true});

        // Write a wrapper script that monkey-patches write then tries to run
        const fs = require('node:fs');
        const tamperPath = r.transpiledOutputPath.replace('.vm.js', '.tamper.js');
        const vmPath = r.vmOutputPath;
        const original = fs.readFileSync(r.transpiledOutputPath, 'utf-8');
        // Inject monkey-patch before the first JSVM usage
        const tamperScript = `
const JSVM = require(${JSON.stringify(vmPath)});
JSVM.prototype.write = function(reg, val) { this.registers[reg] = val; };
${original}
`;
        fs.writeFileSync(tamperPath, tamperScript);
        const result = spawnSync('node', [tamperPath], {encoding: 'utf-8', timeout: 10000});
        // Should either throw or produce wrong output — not produce correct '1'
        const threw = result.stderr && result.stderr.includes('integrity');
        const wrongOutput = result.stdout.trim() !== '1';
        expect(threw || wrongOutput).toBe(true);
        fs.unlinkSync(tamperPath);
    });

    test('combined: integrityCheck + handlerObfuscation + stringEncryption', async () => {
        const code = `
// @virtualize
function greet(name){return 'Hello, '+name+'!'}
console.log(greet('World'))`;
        const r = await transpile(code, {
            ...BASE_OPTS,
            fileName: 'ic_combo',
            integrityCheck: true,
            handlerObfuscation: true,
            stringEncryption: true,
        });
        expect(run(r.transpiledOutputPath)).toBe('Hello, World!');
    });

    test('combined: all four protections', async () => {
        const code = `
// @virtualize
function classify(x){
    if(x>0)return 'pos';
    if(x<0)return 'neg';
    return 'zero';
}
console.log(classify(1));
console.log(classify(-1));
console.log(classify(0));`;
        const r = await transpile(code, {
            ...BASE_OPTS,
            fileName: 'ic_all',
            integrityCheck: true,
            handlerObfuscation: true,
            stringEncryption: true,
            registerEncryption: true,
        });
        expect(run(r.transpiledOutputPath)).toBe('pos\nneg\nzero');
    });
});
