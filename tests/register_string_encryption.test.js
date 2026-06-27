'use strict';

const {spawnSync} = require('node:child_process');
const {transpile} = require('../src/transpile');

const {
    deriveStrEncSeed,
    strKeyMask,
    encodeStringWithKey,
    buildStringEncryptionPatch,
    applyStringEncryption,
} = require('../src/utils/stringEncryption');

const {
    deriveRegEncSeed,
    regMask,
    buildRegisterEncryptionPatch,
    applyRegisterEncryption,
} = require('../src/utils/registerEncryption');

function run(filePath) {
    const r = spawnSync('node', [filePath], {encoding: 'utf-8', timeout: 10000});
    if (r.error) throw r.error;
    if (r.stderr && r.stderr.trim()) {
        // surface the first error line in test failures
        const errLine = r.stderr.trim().split('\n')[0];
        if (!r.stdout.trim()) throw new Error('VM crash: ' + errLine);
    }
    return r.stdout.trim();
}

const baseOpts = {passes: ['RemoveUnused'], timeLock: false};

// ---------------------------------------------------------------------------
// Unit — string encryption
// ---------------------------------------------------------------------------

describe('deriveStrEncSeed', () => {
    test('same key → same seed', () => {
        expect(deriveStrEncSeed('key-a')).toBe(deriveStrEncSeed('key-a'));
    });
    test('different keys → different seeds', () => {
        expect(deriveStrEncSeed('key-a')).not.toBe(deriveStrEncSeed('key-b'));
    });
    test('returns 32-bit unsigned', () => {
        const s = deriveStrEncSeed('test');
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(0xFFFFFFFF);
    });
});

describe('strKeyMask', () => {
    test('deterministic', () => {
        expect(strKeyMask(12345, 0)).toBe(strKeyMask(12345, 0));
        expect(strKeyMask(12345, 7)).toBe(strKeyMask(12345, 7));
    });
    test('different indices → different masks (generally)', () => {
        const masks = new Set([0,1,2,3,4,5,6,7].map(i => strKeyMask(99999, i)));
        expect(masks.size).toBeGreaterThan(1);
    });
    test('result fits in byte', () => {
        for (let i = 0; i < 16; i++) {
            expect(strKeyMask(0xdeadbeef, i)).toBeGreaterThanOrEqual(0);
            expect(strKeyMask(0xdeadbeef, i)).toBeLessThanOrEqual(255);
        }
    });
});

describe('encodeStringWithKey round-trip', () => {
    function decode(buf, seed) {
        let str = '';
        const len = buf.length;
        for (let i = 0; i < len; i++) {
            const posMask = ((len * 31 + i * 17) & 0xFF);
            const keyMask = strKeyMask(seed, i);
            str += String.fromCharCode(buf[i] ^ posMask ^ keyMask);
        }
        return str;
    }

    test('Hello, World!', () => {
        const seed = deriveStrEncSeed('round-trip-key');
        const enc = encodeStringWithKey('Hello, World!', seed);
        expect(decode(enc, seed)).toBe('Hello, World!');
    });

    test('empty string', () => {
        const seed = deriveStrEncSeed('empty-key');
        const enc = encodeStringWithKey('', seed);
        expect(enc.length).toBe(0);
        expect(decode(enc, seed)).toBe('');
    });

    test('different keys → different encodings', () => {
        const s1 = deriveStrEncSeed('key-one');
        const s2 = deriveStrEncSeed('key-two');
        const e1 = encodeStringWithKey('test', s1);
        const e2 = encodeStringWithKey('test', s2);
        expect(e1.equals(e2)).toBe(false);
    });

    test('same key → same encoding (deterministic)', () => {
        const seed = deriveStrEncSeed('det-key');
        const e1 = encodeStringWithKey('deterministic', seed);
        const e2 = encodeStringWithKey('deterministic', seed);
        expect(e1.equals(e2)).toBe(true);
    });
});

describe('buildStringEncryptionPatch', () => {
    test('contains readString override', () => {
        const p = buildStringEncryptionPatch(12345678);
        expect(p).toContain('readString');
        expect(p).toContain('_se_seed=12345678');
    });
    test('different seeds → different patches', () => {
        expect(buildStringEncryptionPatch(111)).not.toBe(buildStringEncryptionPatch(222));
    });
});

describe('applyStringEncryption string injection', () => {
    const FAKE_VM = `const implOpcode = {};\nclass JSVM {}\nif (typeof module !== 'undefined' && module.exports) { module.exports = JSVM }`;

    test('inserts readString patch between implOpcode and class JSVM', () => {
        const r = applyStringEncryption(FAKE_VM, 'inj-key');
        const pIdx = r.indexOf('_vm.prototype.readString');
        const cIdx = r.indexOf('class JSVM');
        expect(pIdx).toBeGreaterThan(-1);
        expect(pIdx).toBeGreaterThan(cIdx);
    });

    test('patch contains override for ADD', () => {
        const r = applyStringEncryption(FAKE_VM, 'inject-test-key');
        expect(r).toContain('_se_seed');
    });

    test('patch contains readString override', () => {
        const r = applyStringEncryption(FAKE_VM, 'inject-test-key');
        expect(r).toContain('readString');
    });

    test('different keys produce different patches', () => {
        const r1 = applyStringEncryption(FAKE_VM, 'key-one');
        const r2 = applyStringEncryption(FAKE_VM, 'key-two');
        expect(r1).not.toBe(r2);
    });
});

// ---------------------------------------------------------------------------
// Unit — register encryption
// ---------------------------------------------------------------------------

describe('deriveRegEncSeed', () => {
    test('same key → same seed', () => {
        expect(deriveRegEncSeed('key-x')).toBe(deriveRegEncSeed('key-x'));
    });
    test('different keys → different seeds', () => {
        expect(deriveRegEncSeed('key-x')).not.toBe(deriveRegEncSeed('key-y'));
    });
});

describe('regMask', () => {
    test('deterministic', () => {
        expect(regMask(111, 5, 0)).toBe(regMask(111, 5, 0));
    });
    test('register-dependent', () => {
        expect(regMask(111, 3, 0)).not.toBe(regMask(111, 7, 0));
    });
    test('epoch-dependent', () => {
        expect(regMask(111, 5, 0)).not.toBe(regMask(111, 5, 1));
    });
    test('encode-decode cancels out', () => {
        const seed = deriveRegEncSeed('cancel-key');
        const val = 42;
        const enc = (val ^ regMask(seed, 10, 0)) >>> 0;
        const dec = (enc ^ regMask(seed, 10, 0)) | 0;
        expect(dec).toBe(val);
    });
});

describe('buildRegisterEncryptionPatch', () => {
    test('contains write override', () => {
        const p = buildRegisterEncryptionPatch(0xdeadbeef);
        expect(p).toContain('_vm.prototype.write');
        expect(p).toContain('_vm.prototype.readStored');
    });
    test('contains seed', () => {
        const p = buildRegisterEncryptionPatch(12345);
        expect(p).toContain('12345');
    });
    test('different seeds → different patches', () => {
        expect(buildRegisterEncryptionPatch(1)).not.toBe(buildRegisterEncryptionPatch(2));
    });
});

describe('applyRegisterEncryption string injection', () => {
    const FAKE_VM = `var implOpcode = {};\nclass JSVM {}\nif (typeof module !== 'undefined' && module.exports) { module.exports = JSVM }`;

    test('inserts write patch after class JSVM', () => {
        const r = applyRegisterEncryption(FAKE_VM, 'inj-key');
        const pIdx = r.indexOf('_vm.prototype.write');
        const cIdx = r.indexOf('class JSVM');
        expect(pIdx).toBeGreaterThan(-1);
        expect(pIdx).toBeGreaterThan(cIdx);
    });
});

// ---------------------------------------------------------------------------
// Integration — stringEncryption option
// ---------------------------------------------------------------------------

describe('transpile with stringEncryption', () => {
    test('disabled: VM does not contain _se_seed', async () => {
        const code = `// @virtualize\nfunction f(s){return s}\nconsole.log(f('hi'))`;
        const r = await transpile(code, {...baseOpts, fileName: 'se_off', stringEncryption: false});
        expect(r.vm).not.toContain('_se_seed');
    });

    test('enabled: VM contains _se_seed', async () => {
        const code = `// @virtualize\nfunction f(s){return s}\nconsole.log(f('hi'))`;
        const r = await transpile(code, {...baseOpts, fileName: 'se_on', stringEncryption: true});
        expect(r.vm).toContain('_se_seed');
        expect(r.vm).toContain('readString');
    });

    test('simple string passthrough', async () => {
        const code = `// @virtualize\nfunction f(s){return s}\nconsole.log(f('hello'))`;
        const r = await transpile(code, {...baseOpts, fileName: 'se_pass', stringEncryption: true});
        expect(run(r.transpiledOutputPath)).toBe('hello');
    });

    test('string literal in function body', async () => {
        const code = `// @virtualize\nfunction greet(name){return 'Hello, '+name+'!'}\nconsole.log(greet('World'))`;
        const r = await transpile(code, {...baseOpts, fileName: 'se_greet', stringEncryption: true});
        expect(run(r.transpiledOutputPath)).toBe('Hello, World!');
    });

    test('multiple distinct strings', async () => {
        const code = `
// @virtualize
function labels() {
    return ['alpha', 'beta', 'gamma'].join('-');
}
console.log(labels())`;
        const r = await transpile(code, {...baseOpts, fileName: 'se_multi', stringEncryption: true});
        expect(run(r.transpiledOutputPath)).toBe('alpha-beta-gamma');
    });

    test('string comparison', async () => {
        const code = `
// @virtualize
function check(s) {
    return s === 'secret' ? 'yes' : 'no';
}
console.log(check('secret'));
console.log(check('other'));`;
        const r = await transpile(code, {...baseOpts, fileName: 'se_cmp', stringEncryption: true});
        expect(run(r.transpiledOutputPath)).toBe('yes\nno');
    });

    test('combined with handlerObfuscation', async () => {
        const code = `
// @virtualize
function f(a, b) { return a + b + ' end'; }
console.log(f(1, 2))`;
        const r = await transpile(code, {
            ...baseOpts,
            fileName: 'se_hob',
            stringEncryption: true,
            handlerObfuscation: true,
        });
        expect(run(r.transpiledOutputPath)).toBe('3 end');
    });

    test('patch inserted after class JSVM', async () => {
        const code = `// @virtualize\nfunction f(s){return s}\nconsole.log(f('x'))`;
        const r = await transpile(code, {...baseOpts, fileName: 'se_pos', stringEncryption: true});
        const pIdx = r.vm.indexOf('_se_seed');
        const cIdx = r.vm.indexOf('class JSVM');
        expect(pIdx).toBeGreaterThan(cIdx);
    });
});

// ---------------------------------------------------------------------------
// Integration — registerEncryption option
// ---------------------------------------------------------------------------

describe('transpile with registerEncryption', () => {
    test('disabled: VM does not contain _re_seed', async () => {
        const code = `// @virtualize\nfunction f(a){return a+1}\nconsole.log(f(0))`;
        const r = await transpile(code, {...baseOpts, fileName: 're_off', registerEncryption: false});
        expect(r.vm).not.toContain('_re_seed');
    });

    test('enabled: VM contains _re_seed', async () => {
        const code = `// @virtualize\nfunction f(a){return a+1}\nconsole.log(f(0))`;
        const r = await transpile(code, {...baseOpts, fileName: 're_on', registerEncryption: true});
        expect(r.vm).toContain('_re_seed');
        expect(r.vm).toContain('_re_mask');
    });

    test('integer arithmetic: 2 + 3 = 5', async () => {
        const code = `// @virtualize\nfunction f(a,b){return a+b}\nconsole.log(f(2,3))`;
        const r = await transpile(code, {...baseOpts, fileName: 're_add', registerEncryption: true});
        expect(run(r.transpiledOutputPath)).toBe('5');
    });

    test('counter loop: sumTo(10) = 55', async () => {
        const code = `
// @virtualize
function sumTo(n){
    let s=0;
    for(let i=1;i<=n;i++) s+=i;
    return s;
}
console.log(sumTo(10))`;
        const r = await transpile(code, {...baseOpts, fileName: 're_loop', registerEncryption: true});
        expect(run(r.transpiledOutputPath)).toBe('55');
    });

    test('string values pass through unencrypted', async () => {
        const code = `// @virtualize\nfunction f(s){return s}\nconsole.log(f('ok'))`;
        const r = await transpile(code, {...baseOpts, fileName: 're_str', registerEncryption: true});
        expect(run(r.transpiledOutputPath)).toBe('ok');
    });

    test('boolean values pass through', async () => {
        const code = `// @virtualize\nfunction f(a,b){return a===b}\nconsole.log(f(1,1))`;
        const r = await transpile(code, {...baseOpts, fileName: 're_bool', registerEncryption: true});
        expect(run(r.transpiledOutputPath)).toBe('true');
    });

    test('patch inserted after class JSVM', async () => {
        const code = `// @virtualize\nfunction f(a){return a}\nconsole.log(f(1))`;
        const r = await transpile(code, {...baseOpts, fileName: 're_pos', registerEncryption: true});
        const pIdx = r.vm.indexOf('_re_seed');
        const cIdx = r.vm.indexOf('class JSVM');
        expect(pIdx).toBeGreaterThan(cIdx);
    });

    test('combined: registerEncryption + stringEncryption + handlerObfuscation', async () => {
        const code = `
// @virtualize
function classify(x) {
    if (x > 0) return 'pos';
    if (x < 0) return 'neg';
    return 'zero';
}
console.log(classify(1));
console.log(classify(-1));
console.log(classify(0));`;
        const r = await transpile(code, {
            ...baseOpts,
            fileName: 're_all',
            registerEncryption: true,
            stringEncryption: true,
            handlerObfuscation: true,
        });
        expect(run(r.transpiledOutputPath)).toBe('pos\nneg\nzero');
    });
});
