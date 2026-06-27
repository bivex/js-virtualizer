'use strict';

/**
 * Register File Encryption
 *
 * Wraps JSVM read/write with a lightweight XOR cipher keyed off
 * bytecodeIntegrityKey. Only numeric integer values are encrypted —
 * strings, objects, booleans, null/undefined pass through unchanged so
 * semantics are never broken.
 *
 * Cipher: value ^ mask(register, epoch)
 *   mask(r, e) = lcg(seed ^ r ^ (e * 0x9e3779b9)) & 0xFFFFFFFF
 *
 * epoch increments each time the epoch register (IP) wraps — cheap,
 * unpredictable from a static dump.
 *
 * Patch strategy: IIFE inserted between implOpcode and class JSVM,
 * same anchor as handlerObfuscation.
 */

const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Seed derivation
// ---------------------------------------------------------------------------

function deriveRegEncSeed(integrityKey) {
    const h = crypto.createHash('sha256').update('regenc:' + integrityKey).digest();
    return ((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0;
}

// ---------------------------------------------------------------------------
// Mask function (must be self-contained for inline codegen)
// ---------------------------------------------------------------------------

function regMask(seed, register, epoch) {
    // LCG mix: fast, register+epoch dependent
    let s = (seed ^ (register * 0x85ebca6b) ^ (epoch * 0x9e3779b9)) >>> 0;
    s = Math.imul(s ^ (s >>> 16), 0x45d9f3b) >>> 0;
    s = Math.imul(s ^ (s >>> 13), 0xc2b2ae35) >>> 0;
    return (s ^ (s >>> 16)) >>> 0;
}

// ---------------------------------------------------------------------------
// Code generator: builds the IIFE patch string
// ---------------------------------------------------------------------------

function buildRegisterEncryptionPatch(seed) {
    return `(function(_vm){
var _re_seed=${seed >>> 0};
function _re_mask(r){
  var s=(_re_seed^Math.imul(r+1,0x9e3779b9))>>>0;
  s=Math.imul(s^(s>>>16),0x85ebca6b)>>>0;
  s=Math.imul(s^(s>>>13),0xc2b2ae35)>>>0;
  return(s^(s>>>16))&0x7FFF;
}
function _re_safe(v){
  return typeof v==='number'&&(v|0)===v&&v>=-2147483648&&v<=2147483647;
}
var _orig_write=_vm.prototype.write;
var _orig_readStored=_vm.prototype.readStored;
_vm.prototype.write=function(reg,val){
  if(_re_safe(val)&&reg>2){
    _orig_write.call(this,reg,(val^_re_mask(reg))|0);
  }else{
    _orig_write.call(this,reg,val);
  }
};
_vm.prototype.readStored=function(reg){
  var raw=_orig_readStored.call(this,reg);
  if(_re_safe(raw)&&reg>2){
    return(raw^_re_mask(reg))|0;
  }
  return raw;
};
})(JSVM);`;
}

// ---------------------------------------------------------------------------
// Inject into VM source
// ---------------------------------------------------------------------------

function applyRegisterEncryption(vmSource, integrityKey) {
    const seed = deriveRegEncSeed(integrityKey);
    const patch = buildRegisterEncryptionPatch(seed);

    // Insert AFTER class JSVM closing brace, before module.exports
    const exportMarker = /if\s*\(typeof module[^}]+module\.exports\s*=[^}]+\}/;
    const expMatch = exportMarker.exec(vmSource);
    if (expMatch) {
        return vmSource.slice(0, expMatch.index) + patch + '\n' + vmSource.slice(expMatch.index);
    }

    // Fallback: before last module.exports
    const idx = vmSource.lastIndexOf('module.exports');
    if (idx !== -1) {
        return vmSource.slice(0, idx) + patch + '\n' + vmSource.slice(idx);
    }

    return vmSource;
}

module.exports = {
    deriveRegEncSeed,
    regMask,
    buildRegisterEncryptionPatch,
    applyRegisterEncryption,
};
