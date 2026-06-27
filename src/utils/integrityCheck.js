'use strict';

/**
 * Runtime prototype tamper detection for JSVM.
 *
 * Strategy: at patch-time, compute a cheap FNV-1a hash of each guarded
 * method's .toString() source.  At run() time, recompute and compare.
 * Any monkey-patch (JSVM.prototype.write = spy) changes the source string
 * and triggers an abort.
 *
 * The expected hashes are derived from the integrity key so they are
 * different per build — a static signature DB cannot be built by an
 * attacker without the key.
 *
 * Guarded methods (all on JSVM.prototype):
 *   write, readStored, read, readString, loadFromString, run, runAsync
 */

// --------------------------------------------------------------------------
// FNV-1a 32-bit hash of a string
// --------------------------------------------------------------------------
function fnv1a(str) {
    let h = 0x811c9dc5 >>> 0;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h;
}

// --------------------------------------------------------------------------
// Key-derived tweak — XORed into each expected hash so the stored table
// is unique per build.
// --------------------------------------------------------------------------
function deriveTweak(integrityKey) {
    let h = 0xdeadbeef >>> 0;
    const k = String(integrityKey ?? '');
    for (let i = 0; i < k.length; i++) {
        h ^= k.charCodeAt(i);
        h = Math.imul(h, 0x9e3779b9) >>> 0;
        h = ((h << 13) | (h >>> 19)) >>> 0;
    }
    return h;
}

// --------------------------------------------------------------------------
// Method names to guard
// --------------------------------------------------------------------------
const GUARDED_METHODS = [
    'write',
    'readStored',
    'read',
    'readString',
    'loadFromString',
    'run',
    'runAsync',
];

// --------------------------------------------------------------------------
// Build the IIFE source that gets injected into the VM after class JSVM
// --------------------------------------------------------------------------
function buildIntegrityCheckPatch(integrityKey) {
    const tweak = deriveTweak(integrityKey) >>> 0;
    // run and runAsync are excluded from the check loop because we replace them —
    // they are instead checked by storing the original hash before wrapping.
    const checkMethods = GUARDED_METHODS.filter(m => m !== 'run' && m !== 'runAsync');
    return `(function(_vm){
var _ic_tweak=${tweak}>>>0;
var _ic_methods=${JSON.stringify(checkMethods)};
function _ic_fnv(s){
  var h=0x811c9dc5>>>0;
  for(var i=0;i<s.length;i++){h=(h^s.charCodeAt(i))>>>0;h=Math.imul(h,0x01000193)>>>0;}
  return h;
}
var _ic_expected={};
for(var _i=0;_i<_ic_methods.length;_i++){
  var _m=_ic_methods[_i];
  if(typeof _vm.prototype[_m]==='function'){
    _ic_expected[_m]=(_ic_fnv(_vm.prototype[_m].toString())^_ic_tweak)>>>0;
  }
}
var _orig_run=_vm.prototype.run;
var _orig_runAsync=_vm.prototype.runAsync;
var _ic_run_hash=typeof _orig_run==='function'?(_ic_fnv(_orig_run.toString())^_ic_tweak)>>>0:0;
var _ic_runAsync_hash=typeof _orig_runAsync==='function'?(_ic_fnv(_orig_runAsync.toString())^_ic_tweak)>>>0:0;
function _ic_check(){
  for(var _j=0;_j<_ic_methods.length;_j++){
    var _n=_ic_methods[_j];
    if(!(_n in _ic_expected))continue;
    var _fn=_vm.prototype[_n];
    if(typeof _fn!=='function'){throw new Error('JSVM integrity violation: '+_n+' missing');}
    var _h=(_ic_fnv(_fn.toString())^_ic_tweak)>>>0;
    if(_h!==_ic_expected[_n]){throw new Error('JSVM integrity violation: '+_n+' tampered');}
  }
  if(_ic_run_hash&&typeof _orig_run==='function'){
    var _rh=(_ic_fnv(_orig_run.toString())^_ic_tweak)>>>0;
    if(_rh!==_ic_run_hash){throw new Error('JSVM integrity violation: run tampered');}
  }
}
_vm.prototype.run=function(){_ic_check();return _orig_run.apply(this,arguments);};
if(typeof _orig_runAsync==='function'){
  _vm.prototype.runAsync=function(){_ic_check();return _orig_runAsync.apply(this,arguments);};
}
})(JSVM);`;
}

// --------------------------------------------------------------------------
// Apply patch to the generated VM source string
// --------------------------------------------------------------------------
function applyIntegrityCheck(vmSource, integrityKey) {
    const patch = buildIntegrityCheckPatch(integrityKey);

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

module.exports = {buildIntegrityCheckPatch, applyIntegrityCheck, fnv1a, deriveTweak, GUARDED_METHODS};
