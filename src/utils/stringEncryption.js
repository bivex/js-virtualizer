'use strict';

/**
 * String Constant Encryption
 *
 * Strengthens the existing assembler XOR scheme by mixing in a
 * key-derived per-build seed on top of the position mask already used
 * by encodeString/readString.
 *
 * Encoding (compile time, assembler side):
 *   byte[i] = char[i] ^ positionMask(i, len) ^ keyMask(seed, i)
 *
 * Decoding (runtime, JSVM.readString patch):
 *   char[i] = byte[i] ^ positionMask(i, len) ^ keyMask(seed, i)
 *
 * positionMask(i, len) = (len * 31 + i * 17) & 0xFF   ← existing scheme
 * keyMask(seed, i)     = lcg(seed ^ i * 0x9e3779b9) & 0xFF
 *
 * The IIFE patch replaces JSVM.prototype.readString in the generated VM.
 * The encoder is a drop-in wrapper around the existing encodeString.
 */

const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Seed derivation
// ---------------------------------------------------------------------------

function deriveStrEncSeed(integrityKey) {
    const h = crypto.createHash('sha256').update('strenc:' + integrityKey).digest();
    return ((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0;
}

// ---------------------------------------------------------------------------
// Per-character key mask (must match runtime patch exactly)
// ---------------------------------------------------------------------------

function strKeyMask(seed, i) {
    let s = (seed ^ Math.imul(i + 1, 0x9e3779b9)) >>> 0;
    s = Math.imul(s ^ (s >>> 16), 0x85ebca6b) >>> 0;
    return s & 0xFF;
}

// ---------------------------------------------------------------------------
// Encoder: apply extra layer on top of existing XOR scheme
// The existing encodeString already applies positionMask, so we XOR the
// already-encoded bytes with keyMask to add the second layer.
// ---------------------------------------------------------------------------

function encodeStringWithKey(str, seed) {
    const data = Buffer.from(str);
    const len = data.length;
    const out = Buffer.alloc(len);
    for (let i = 0; i < len; i++) {
        // existing mask: (len * 31 + i * 17) & 0xFF
        const posMask = ((len * 31 + i * 17) & 0xFF);
        // extra key mask
        const keyMask = strKeyMask(seed, i);
        out[i] = data[i] ^ posMask ^ keyMask;
    }
    return out;
}

// ---------------------------------------------------------------------------
// Runtime patch generator: replaces readString in JSVM
// ---------------------------------------------------------------------------

function buildStringEncryptionPatch(seed) {
    return `(function(_vm){
var _se_seed=${seed >>> 0};
function _se_mask(i){
  var s=(_se_seed^Math.imul(i+1,0x9e3779b9))>>>0;
  s=Math.imul(s^(s>>>16),0x85ebca6b)>>>0;
  return s&0xFF;
}
_vm.prototype.readString=function(){
  var len=this.readDWORD();
  var str='';
  for(var i=0;i<len;i++){
    var b=this.readByte();
    var posMask=(len*31+i*17)&0xFF;
    var keyMask=_se_mask(i);
    str+=String.fromCharCode(b^posMask^keyMask);
  }
  return str;
};
})(JSVM);`;
}

// ---------------------------------------------------------------------------
// Inject into VM source (same anchor as handlerObfuscation)
// ---------------------------------------------------------------------------

function applyStringEncryption(vmSource, integrityKey) {
    const seed = deriveStrEncSeed(integrityKey);
    const patch = buildStringEncryptionPatch(seed);

    // Insert AFTER class JSVM closing brace, before module.exports
    const exportMarker = /if\s*\(typeof module[^}]+module\.exports\s*=[^}]+\}/;
    const expMatch = exportMarker.exec(vmSource);
    if (expMatch) {
        return vmSource.slice(0, expMatch.index) + patch + '\n' + vmSource.slice(expMatch.index);
    }

    // Fallback: after last closing brace before module.exports
    const idx = vmSource.lastIndexOf('module.exports');
    if (idx !== -1) {
        return vmSource.slice(0, idx) + patch + '\n' + vmSource.slice(idx);
    }

    return vmSource;
}

module.exports = {
    deriveStrEncSeed,
    strKeyMask,
    encodeStringWithKey,
    buildStringEncryptionPatch,
    applyStringEncryption,
};
