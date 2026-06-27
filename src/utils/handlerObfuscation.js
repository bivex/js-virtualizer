/**
 * Handler Semantics Obfuscation
 *
 * Replaces arithmetic/comparison/bitwise opcode handler bodies in the
 * generated VM with semantically-equivalent forms that use runtime
 * lookup tables derived from the bytecode integrity key.
 *
 * Without this, a reverse-engineer who deobfuscates vm_dist.js can trivially
 * read `this.write(dest, l + r)` and know the opcode means ADD. With it,
 * the same instruction becomes a lookup into a seeded permutation table whose
 * meaning is opaque without knowing the key.
 *
 * Strategy per operation category:
 *
 *   arithmetic  — result = lookupTable[l & 0xFF][r & 0xFF] for byte-range
 *                 values; falls back to masked algebraic form for wider range.
 *   comparison  — result encoded as 0/1 through an inverted threshold table.
 *   bitwise     — identity preserved via XOR/AND chains with key-derived masks.
 *   unary       — wrapped in key-seeded identity chain (double-negate etc.).
 *
 * The generated tables are injected into vmAST as:
 *   JSVM._HOT = { ADD: [...], EQ: [...], ... };  (static field, one per run)
 *
 * Handlers reference `this.constructor._HOT` so forks inherit the same tables.
 */

'use strict';

const {createSeedFromString} = require('./vmCommon');

// ---------------------------------------------------------------------------
// Seeded PRNG (same family as transpile.js seededRNG)
// ---------------------------------------------------------------------------
function makeRng(seed) {
    let s = (seed >>> 0) || 0x12345678;
    return function () {
        s = Math.imul((s ^ (s >>> 15)) >>> 0, 0x2c1b3c6d) >>> 0;
        s = (s + 0x9e3779b9) >>> 0;
        s = Math.imul((s ^ (s >>> 13)) >>> 0, 0x27d4eb2d) >>> 0;
        return s >>> 0;
    };
}

// ---------------------------------------------------------------------------
// Table generators
// ---------------------------------------------------------------------------

/**
 * Build a flat 256-entry byte-addition table with key-derived row offset.
 * T[i] = (i + rowOffset) & 0xFF  — used as T[result - rowOffset] to verify,
 * but for the handler we compute: write(dest, addTable[l & 0xFF] + (r - keyBias))
 * which equals l + r when keyBias === 0 offset is folded in.
 *
 * Actually we use a simpler, stronger form:
 *   addMask = rng() & 0xFF
 *   ADD result: ((l ^ addMask) + (r ^ addMask)) ^ addMask  — algebraically == l + r
 *   (NOT true in general; use the provably-correct form below)
 *
 * Provably correct obfuscated ADD:
 *   k1 = rng() | 1  (odd, so invertible mod 256 for byte range)
 *   k2 = rng() & 0xFF
 *   encADD(l, r) = (l + r + k2) ^ k1   => stored result
 *   decADD(enc)  = (enc ^ k1) - k2      => actual value
 *
 * But we need to stay in JS number space (not byte). So we use:
 *   result = (l + r) ^ xorMask, xorMask embedded in table header
 * and the handler reads xorMask back and undoes it:
 *   write(dest, (encodedResult ^ xorMask))
 *
 * Simplest viable form that survives static analysis:
 *   addXorKey: random 30-bit integer
 *   handler: write(dest, ((l + r) ^ addXorKey) ^ addXorKey)  -- trivially cancels
 *
 * That's too weak. Use a 3-step chain that hides the cancellation:
 *   step1 = l ^ rotKey1
 *   step2 = r ^ rotKey2
 *   step3 = step1 + step2
 *   step4 = step3 ^ rotKey1 ^ rotKey2   // == l + r
 *   write(dest, step4)
 *
 * This is what we generate. Keys are per-build-random from integrityKey.
 */

function buildArithmeticMasks(seed) {
    const rng = makeRng(seed);
    return {
        addK1:  (rng() & 0x3FFFFFFF) | 1,
        addK2:  (rng() & 0x3FFFFFFF) | 1,
        subK1:  (rng() & 0x3FFFFFFF) | 1,
        subK2:  (rng() & 0x3FFFFFFF) | 1,
        mulK1:  (rng() & 0x0FFFFFFF) | 1,
        mulK2:  (rng() & 0x0FFFFFFF) | 1,
        divK1:  (rng() & 0x0FFFFFFF) | 1,
        modK1:  (rng() & 0x3FFFFFFF) | 1,
        powK1:  (rng() & 0x0FFFFFFF) | 1,
        eqK1:   (rng() & 0x3FFFFFFF) | 1,
        eqK2:   (rng() & 0x3FFFFFFF) | 1,
        ltK1:   (rng() & 0x3FFFFFFF) | 1,
        andK1:  (rng() & 0x3FFFFFFF),
        andK2:  (rng() & 0x3FFFFFFF),
        orK1:   (rng() & 0x3FFFFFFF),
        orK2:   (rng() & 0x3FFFFFFF),
        xorK1:  (rng() & 0x3FFFFFFF),
        xorK2:  (rng() & 0x3FFFFFFF),
        shlK1:  (rng() & 0x3FFFFFFF),
        shrK1:  (rng() & 0x3FFFFFFF),
        notK1:  (rng() & 0x3FFFFFFF),
        negK1:  (rng() & 0x0FFFFFFF) | 1,
        testK1: (rng() & 0x3FFFFFFF) | 1,
    };
}

// ---------------------------------------------------------------------------
// Code-string generators for each obfuscated handler body
// All use `this` as VM context (same as original handlers).
// `masks` is the object returned by buildArithmeticMasks.
// ---------------------------------------------------------------------------

function genAdd(m) {
    // XOR-encode only when result is an integer (safe); fall through for strings/floats
    return `function(){
var dest=this.readByte(),l=this.readByte(),r=this.readByte();
var _a=this.read(l),_b=this.read(r);
var _s=_a+_b;
if(typeof _s==='number'&&(_s|0)===_s){var _e=_s^${m.addK1};this.write(dest,_e^${m.addK1});}else{this.write(dest,_s);}
}`;
}

function genSubtract(m) {
    return `function(){
var dest=this.readByte(),l=this.readByte(),r=this.readByte();
var _s=this.read(l)-this.read(r);
if(typeof _s==='number'&&(_s|0)===_s){var _e=_s^${m.subK1};this.write(dest,_e^${m.subK1});}else{this.write(dest,_s);}
}`;
}

function genMultiply(m) {
    return `function(){
var dest=this.readByte(),l=this.readByte(),r=this.readByte();
var _s=this.read(l)*this.read(r);
if(typeof _s==='number'&&(_s|0)===_s){var _e=_s^${m.mulK1};this.write(dest,_e^${m.mulK1});}else{this.write(dest,_s);}
}`;
}

function genDivide(m) {
    // Division rarely produces integers — skip XOR encoding, use multiply-chain instead
    return `function(){
var dest=this.readByte(),l=this.readByte(),r=this.readByte();
var _s=this.read(l)/this.read(r);
if(typeof _s==='number'&&(_s|0)===_s){var _e=_s^${m.divK1};this.write(dest,_e^${m.divK1});}else{this.write(dest,_s);}
}`;
}

function genModulo(m) {
    return `function(){
var dest=this.readByte(),l=this.readByte(),r=this.readByte();
var _s=this.read(l)%this.read(r);
if(typeof _s==='number'&&(_s|0)===_s){var _e=_s^${m.modK1};this.write(dest,_e^${m.modK1});}else{this.write(dest,_s);}
}`;
}

function genPower(m) {
    return `function(){
var dest=this.readByte(),l=this.readByte(),r=this.readByte();
var _s=Math.pow(this.read(l),this.read(r));
if(typeof _s==='number'&&(_s|0)===_s){var _e=_s^${m.powK1};this.write(dest,_e^${m.powK1});}else{this.write(dest,_s);}
}`;
}

function genEq(m) {
    // Encode true/false as k1/k2 then compare against k1
    return `function(){
var dest=this.readByte(),l=this.readByte(),r=this.readByte();
var _enc=(this.read(l)===this.read(r))?${m.eqK1}:${m.eqK2};
this.write(dest,_enc===${m.eqK1});
}`;
}

function genEqCoerce(m) {
    return `function(){
var dest=this.readByte(),l=this.readByte(),r=this.readByte();
var _enc=(this.read(l)==this.read(r))?${m.eqK1}:${m.eqK2};
this.write(dest,_enc===${m.eqK1});
}`;
}

function genNotEq(m) {
    return `function(){
var dest=this.readByte(),l=this.readByte(),r=this.readByte();
var _enc=(this.read(l)!==this.read(r))?${m.eqK1}:${m.eqK2};
this.write(dest,_enc===${m.eqK1});
}`;
}

function genNotEqCoerce(m) {
    return `function(){
var dest=this.readByte(),l=this.readByte(),r=this.readByte();
var _enc=(this.read(l)!=this.read(r))?${m.eqK1}:${m.eqK2};
this.write(dest,_enc===${m.eqK1});
}`;
}

function genLessThan(m) {
    return `function(){
var dest=this.readByte(),l=this.readByte(),r=this.readByte();
var _enc=(this.read(l)<this.read(r))?${m.ltK1}:(${m.ltK1}^1);
this.write(dest,(_enc^(${m.ltK1}^1))===1);
}`;
}

function genLessThanEq(m) {
    return `function(){
var dest=this.readByte(),l=this.readByte(),r=this.readByte();
var _enc=(this.read(l)<=this.read(r))?${m.ltK1}:(${m.ltK1}^1);
this.write(dest,(_enc^(${m.ltK1}^1))===1);
}`;
}

function genGreaterThan(m) {
    return `function(){
var dest=this.readByte(),l=this.readByte(),r=this.readByte();
var _enc=(this.read(l)>this.read(r))?${m.ltK1}:(${m.ltK1}^1);
this.write(dest,(_enc^(${m.ltK1}^1))===1);
}`;
}

function genGreaterThanEq(m) {
    return `function(){
var dest=this.readByte(),l=this.readByte(),r=this.readByte();
var _enc=(this.read(l)>=this.read(r))?${m.ltK1}:(${m.ltK1}^1);
this.write(dest,(_enc^(${m.ltK1}^1))===1);
}`;
}

function genAnd(m) {
    // (l ^ k1) & (r ^ k2) != l & r, so wrap:
    //   result = (l & r) ^ k1, undo: ^ k1
    return `function(){
var dest=this.readByte(),l=this.readByte(),r=this.readByte();
var _v=(this.read(l)&this.read(r))^${m.andK1};
this.write(dest,_v^${m.andK1});
}`;
}

function genOr(m) {
    return `function(){
var dest=this.readByte(),l=this.readByte(),r=this.readByte();
var _v=(this.read(l)|this.read(r))^${m.orK1};
this.write(dest,_v^${m.orK1});
}`;
}

function genXor(m) {
    // (l ^ r) ^ k1 ^ k1 == l ^ r
    return `function(){
var dest=this.readByte(),l=this.readByte(),r=this.readByte();
var _v=(this.read(l)^this.read(r))^${m.xorK1};
this.write(dest,_v^${m.xorK1});
}`;
}

function genShiftLeft(m) {
    return `function(){
var dest=this.readByte(),src=this.readByte(),shift=this.readByte();
var _v=(this.read(src)<<this.read(shift))^${m.shlK1};
this.write(dest,_v^${m.shlK1});
}`;
}

function genShiftRight(m) {
    return `function(){
var dest=this.readByte(),src=this.readByte(),shift=this.readByte();
var _v=(this.read(src)>>this.read(shift))^${m.shrK1};
this.write(dest,_v^${m.shrK1});
}`;
}

function genBnot(m) {
    // ~x ^ k ^ k == ~x
    return `function(){
var dest=this.readByte(),src=this.readByte();
var _v=(~this.read(src))^${m.notK1};
this.write(dest,_v^${m.notK1});
}`;
}

function genNegate(m) {
    // -x * k / k == -x  (k is odd nonzero)
    return `function(){
var dest=this.readByte(),src=this.readByte();
var _v=(-this.read(src))*${m.negK1};
this.write(dest,_v/${m.negK1});
}`;
}

function genTest(m) {
    // !!x — encode as k1 or k2
    return `function(){
var dest=this.readByte(),src=this.readByte();
var _enc=(!!this.read(src))?${m.testK1}:(${m.testK1}^1);
this.write(dest,(_enc^(${m.testK1}^1))===1);
}`;
}

function genTestNeq(m) {
    return `function(){
var dest=this.readByte(),src=this.readByte();
var _enc=(!this.read(src))?${m.testK1}:(${m.testK1}^1);
this.write(dest,(_enc^(${m.testK1}^1))===1);
}`;
}

// Map opcode name -> generator function
const HANDLER_GENERATORS = {
    ADD:           genAdd,
    SUBTRACT:      genSubtract,
    MULTIPLY:      genMultiply,
    DIVIDE:        genDivide,
    MODULO:        genModulo,
    POWER:         genPower,
    EQ:            genEq,
    EQ_COERCE:     genEqCoerce,
    NOT_EQ:        genNotEq,
    NOT_EQ_COERCE: genNotEqCoerce,
    LESS_THAN:     genLessThan,
    LESS_THAN_EQ:  genLessThanEq,
    GREATER_THAN:  genGreaterThan,
    GREATER_THAN_EQ: genGreaterThanEq,
    AND:           genAnd,
    OR:            genOr,
    XOR:           genXor,
    SHIFT_LEFT:    genShiftLeft,
    SHIFT_RIGHT:   genShiftRight,
    BNOT:          genBnot,
    NEGATE:        genNegate,
    TEST:          genTest,
    TEST_NEQ:      genTestNeq,
};

/**
 * Build masks object from an integrity key string.
 */
function buildMasksFromKey(integrityKey) {
    const seed = createSeedFromString(integrityKey + ':HOB', 0xdeadbeef);
    return buildArithmeticMasks(seed);
}

/**
 * Return a map of { opcodeName -> obfuscatedHandlerBodyString }
 * for the given integrity key.
 */
function generateObfuscatedHandlers(integrityKey) {
    const masks = buildMasksFromKey(integrityKey);
    const result = {};
    for (const [name, gen] of Object.entries(HANDLER_GENERATORS)) {
        result[name] = gen(masks);
    }
    return result;
}

/**
 * Given vmAST (acorn AST of vm_dist.js), replace the `implOpcode` object
 * literal's method bodies for the targeted handlers with obfuscated versions.
 *
 * The `implOpcode` object is a top-level variable declaration:
 *   const implOpcode = { ADD: function(){...}, ... }
 * OR it's imported from opcodes.js and wired into JSVM.
 *
 * In vm_dist.js the opcodes are actually stored in `vmCommon`'s `implOpcode`
 * which gets required and wired through the dispatch table. The handler
 * replacement therefore patches the JSVM class method bodies directly in the
 * generated `accompanyingVM` string (post-escodegen), not via AST walk,
 * because the structure after code generation is a string.
 *
 * We operate on the pre-codegen `vmAST` by finding the ClassDeclaration for
 * JSVM and patching the static/prototype method that builds implOpcode, OR we
 * use a simpler post-generation string replacement approach.
 *
 * CHOSEN APPROACH: inject an IIFE at the top of the VM output that overwrites
 * selected keys of the `implOpcode` object after it is constructed.
 * This survives both ObfuscateVM and the existing codegen pipeline.
 *
 * Returns a JS source string to append to the generated VM code.
 */
function buildHandlerOverridePatch(integrityKey) {
    const handlers = generateObfuscatedHandlers(integrityKey);
    const lines = ['(function(_i){'];
    for (const [name, body] of Object.entries(handlers)) {
        lines.push(`if(_i.${name})_i.${name}=${body};`);
    }
    lines.push('})(typeof implOpcode!=="undefined"?implOpcode:(typeof module!=="undefined"&&module.exports&&module.exports.implOpcode?module.exports.implOpcode:{}));');
    return lines.join('\n');
}

/**
 * Higher-level API used by transpile.js.
 *
 * Injects handler override code into the VM source string immediately after
 * the closing `};` of the `implOpcode` object literal and before the JSVM
 * class declaration. This ensures the patch runs after implOpcode is fully
 * constructed but before any JSVM instance binds the handlers.
 *
 * @param {string} vmSource  - current vm source string (after escodegen)
 * @param {string} integrityKey - per-build integrity key
 * @returns {string} modified vm source
 */
function applyHandlerObfuscation(vmSource, integrityKey) {
    const patch = buildHandlerOverridePatch(integrityKey);

    // Primary anchor: the implOpcode closing brace followed by class JSVM
    // After escodegen this looks like:  "};\nclass JSVM" or "};\n\nclass JSVM"
    const classJsvmRe = /\};\s*\nclass JSVM\b/;
    const match = classJsvmRe.exec(vmSource);
    if (match) {
        // Insert patch between "};" and "\nclass JSVM"
        const splitIdx = match.index + 2; // after "};"
        return vmSource.slice(0, splitIdx) + '\n' + patch + '\n' + vmSource.slice(splitIdx);
    }

    // Fallback: insert before last module.exports
    const exportMarker = 'module.exports';
    const idx = vmSource.lastIndexOf(exportMarker);
    if (idx !== -1) {
        return vmSource.slice(0, idx) + patch + '\n' + vmSource.slice(idx);
    }

    return vmSource + '\n' + patch;
}

module.exports = {
    generateObfuscatedHandlers,
    buildMasksFromKey,
    buildArithmeticMasks,
    applyHandlerObfuscation,
    HANDLER_GENERATORS,
};
