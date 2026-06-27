'use strict';

/**
 * Opaque Constants Protection
 *
 * Encrypts numeric literal payloads in the bytecode (LOAD_BYTE, LOAD_DWORD,
 * LOAD_FLOAT, MACRO_LOAD_DWORD_PAIR operands) with a key-derived,
 * position-keyed XOR stream so that a static dump shows no recognisable
 * integer values.
 *
 * Approach
 * --------
 * Compile time: walk VMChunk.code; for LOAD_BYTE / LOAD_DWORD / LOAD_FLOAT /
 * MACRO_LOAD_DWORD_PAIR, XOR only the VALUE bytes (not opcode or register
 * bytes) with mask8(bytePosition, seed).
 *
 * Runtime: IIFE (inserted after class JSVM) replaces the four opcode handler
 * functions in implOpcode with versions that read raw bytes and un-mask them
 * in-place before writing to the register.  readByte / readDWORD themselves
 * are NOT wrapped — only the specific handlers are replaced so register bytes
 * and opcode bytes remain unaffected.
 *
 * Mask: mask8(pos, seed) = low 8 bits of a murmur-style mix of pos and seed.
 * Identical implementation in build-time JS and injected IIFE string.
 */

const {opcodes} = require('./constants');

// ---------------------------------------------------------------------------
// Seed derivation
// ---------------------------------------------------------------------------
function deriveOpaqueConstSeed(integrityKey) {
    let h = 0xc3d2e1f0 >>> 0;
    const k = String(integrityKey ?? '');
    for (let i = 0; i < k.length; i++) {
        h ^= k.charCodeAt(i);
        h = Math.imul(h, 0x5bd1e995) >>> 0;
        h = ((h << 15) | (h >>> 17)) >>> 0;
    }
    h ^= h >>> 13;
    h = Math.imul(h, 0x85ebca6b) >>> 0;
    h ^= h >>> 16;
    return h >>> 0;
}

// ---------------------------------------------------------------------------
// mask8: single-byte mask for byte-offset `pos` in the serialised bytecode.
// Must produce identical results in Node.js and in the injected IIFE string.
// ---------------------------------------------------------------------------
function mask8(pos, seed) {
    let s = (seed ^ Math.imul((pos + 1) >>> 0, 0x9e3779b9)) >>> 0;
    s = Math.imul(s ^ (s >>> 16), 0x85ebca6b) >>> 0;
    s = Math.imul(s ^ (s >>> 13), 0xc2b2ae35) >>> 0;
    return (s ^ (s >>> 16)) & 0xFF;
}

// ---------------------------------------------------------------------------
// Compile-time pass: encrypt value operands in a VMChunk
// ---------------------------------------------------------------------------
function encryptChunkConstants(chunk, seed) {
    let pos = 0;

    for (const opcode of chunk.code) {
        const opLen = 1 + opcode.data.length;

        if (opcode.name === 'LOAD_BYTE') {
            // [opcode(1), reg(1), value(1)]  — value at pos+2
            opcode.data[1] ^= mask8(pos + 2, seed);

        } else if (opcode.name === 'LOAD_DWORD') {
            // [opcode(1), reg(1), b0..b3(4)]  — values at pos+2..pos+5
            for (let i = 0; i < 4; i++) {
                opcode.data[1 + i] ^= mask8(pos + 2 + i, seed);
            }

        } else if (opcode.name === 'LOAD_FLOAT') {
            // [opcode(1), reg(1), 8 float bytes]  — values at pos+2..pos+9
            for (let i = 0; i < 8; i++) {
                opcode.data[1 + i] ^= mask8(pos + 2 + i, seed);
            }

        } else if (opcode.name === 'MACRO_LOAD_DWORD_PAIR') {
            // [opcode(1), r1(1), v1(4), r2(1), v2(4), pad(1)]
            // v1 at pos+2..pos+5, v2 at pos+7..pos+10
            for (let i = 0; i < 4; i++) {
                opcode.data[1 + i] ^= mask8(pos + 2 + i, seed);
            }
            for (let i = 0; i < 4; i++) {
                opcode.data[6 + i] ^= mask8(pos + 7 + i, seed);
            }
        }

        pos += opLen;
    }
}

// ---------------------------------------------------------------------------
// Runtime IIFE: patches implOpcode handlers BEFORE class JSVM is defined,
// so the constructor's bind() picks up the new functions automatically.
// No _rebindOpcodes needed.
// ---------------------------------------------------------------------------
function buildOpaqueConstantsPatch(seed) {
    return `(function(_impl){
var _oc_seed=${seed >>> 0}>>>0;
function _oc_m(pos){
  var s=(_oc_seed^Math.imul((pos+1)>>>0,0x9e3779b9))>>>0;
  s=Math.imul(s^(s>>>16),0x85ebca6b)>>>0;
  s=Math.imul(s^(s>>>13),0xc2b2ae35)>>>0;
  return(s^(s>>>16))&0xFF;
}
_impl.LOAD_BYTE=function(){
  var reg=this.readByte();
  var vpos=this.read(0);
  var val=this.readByte()^_oc_m(vpos);
  this.write(reg,val);
};
_impl.LOAD_DWORD=function(){
  var reg=this.readByte();
  var vpos=this.read(0);
  var b0=this.readByte()^_oc_m(vpos);
  var b1=this.readByte()^_oc_m(vpos+1);
  var b2=this.readByte()^_oc_m(vpos+2);
  var b3=this.readByte()^_oc_m(vpos+3);
  var val=(this.vmProfile&&this.vmProfile.polyEndian==='LE')
    ?(b0|b1<<8|b2<<16|b3<<24)
    :(b0<<24|b1<<16|b2<<8|b3);
  this.write(reg,val);
};
_impl.LOAD_FLOAT=function(){
  var reg=this.readByte();
  var vpos=this.read(0);
  var bytes=[];
  for(var i=0;i<8;i++)bytes.push(this.readByte()^_oc_m(vpos+i));
  var sign=bytes[0]>>7;
  var exp=((bytes[0]&0x7F)<<4)|(bytes[1]>>4);
  var mantBits='';
  mantBits+=(bytes[1]&0xF).toString(2).padStart(4,'0');
  for(var i=2;i<8;i++)mantBits+=bytes[i].toString(2).padStart(8,'0');
  var mant=1;
  for(var i=0;i<mantBits.length;i++)mant+=parseInt(mantBits[i])*Math.pow(2,-(i+1));
  this.write(reg,(sign?-1:1)*mant*Math.pow(2,exp-1023));
};
_impl.MACRO_LOAD_DWORD_PAIR=function(){
  var le=(this.vmProfile&&this.vmProfile.polyEndian==='LE');
  var r1=this.readByte();
  var vpos1=this.read(0);
  var a0=this.readByte()^_oc_m(vpos1),a1=this.readByte()^_oc_m(vpos1+1);
  var a2=this.readByte()^_oc_m(vpos1+2),a3=this.readByte()^_oc_m(vpos1+3);
  var r2=this.readByte();
  var vpos2=this.read(0);
  var b0=this.readByte()^_oc_m(vpos2),b1=this.readByte()^_oc_m(vpos2+1);
  var b2=this.readByte()^_oc_m(vpos2+2),b3=this.readByte()^_oc_m(vpos2+3);
  this.readByte();
  var v1=le?(a0|a1<<8|a2<<16|a3<<24):(a0<<24|a1<<16|a2<<8|a3);
  var v2=le?(b0|b1<<8|b2<<16|b3<<24):(b0<<24|b1<<16|b2<<8|b3);
  this.write(r1,v1);
  this.write(r2,v2);
};
})(implOpcode);`;}

// ---------------------------------------------------------------------------
// Apply to VM source string — insert immediately BEFORE class JSVM
// so the IIFE runs before the constructor bind()s implOpcode handlers.
// ---------------------------------------------------------------------------
function applyOpaqueConstants(vmSource, integrityKey) {
    const seed = deriveOpaqueConstSeed(integrityKey);
    const patch = buildOpaqueConstantsPatch(seed);

    // Find 'class JSVM' declaration and insert patch just before it
    const classMarker = /\nclass JSVM\b/;
    const m = classMarker.exec(vmSource);
    if (m) {
        return vmSource.slice(0, m.index) + '\n' + patch + vmSource.slice(m.index);
    }

    // Fallback: before module.exports
    const exportMarker = /if\s*\(typeof module[^}]+module\.exports\s*=[^}]+\}/;
    const expMatch = exportMarker.exec(vmSource);
    if (expMatch) {
        return vmSource.slice(0, expMatch.index) + patch + '\n' + vmSource.slice(expMatch.index);
    }

    const idx = vmSource.lastIndexOf('module.exports');
    if (idx !== -1) {
        return vmSource.slice(0, idx) + patch + '\n' + vmSource.slice(idx);
    }

    return vmSource;
}

module.exports = {
    deriveOpaqueConstSeed,
    mask8,
    encryptChunkConstants,
    buildOpaqueConstantsPatch,
    applyOpaqueConstants,
};
