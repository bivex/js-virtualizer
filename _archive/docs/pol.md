# Plan: Polymorphic VM (Register Scrambling + DWORD Endianness)

## Context
js-virtualizer already has opcode shuffling, stateful encoding, jump target encoding, per-instruction encoding, and profile randomization. But the register numbering and DWORD byte order are identical across builds. Adding two polymorphic transforms so each build produces structurally different bytecode for the same source code — defeating automated devirtualizers that target a fixed ISA.

## New Option
- `polymorphic: bool` (default: true)

## Two Transforms

### 1. Register Scrambling (transpile-time only, zero VM overhead)
Permute register indices [3, registerCount-2] so the same logical variable uses different register numbers per build. Special registers (IP=0, UNDEFINED=1, VOID=2) and CFF state register (registerCount-1) stay fixed.

**Approach**: Intercept `randomRegister()` return value with scramble map. Every register allocation flows through this method — variables, temp loads, dependencies, params, output register.

**Key**: `reservedRegisters` tracks logical (pre-scramble) indices. `removeRegister()` uses reverse map to find logical index from physical. Opaque scratch registers get scrambled before passing to `insertOpaquePredicates()`.

### 2. DWORD Endianness (profile-driven, stored in VM profile)
Randomly choose BE or LE per build. `encodeDWORD()` produces bytes in chosen endianness. VM's `readDWORD()` and `readJumpTargetDWORD()` read in the profile-specified order. Stored as `polyEndian: "BE" | "LE"` in VM profile JSON.

---

## File Changes

### 1. `src/utils/assembler.js` — Endian-aware encodeDWORD
Add module-level `_endian` setting (default "BE"):
```js
let _endian = "BE";
function setEndian(e) { _endian = e === "LE" ? "LE" : "BE"; }
function getEndian() { return _endian; }
function encodeDWORD(dword) {
    const buf = Buffer.alloc(4);
    if (_endian === "LE") {
        buf[0] = dword & 0xFF; buf[1] = (dword >> 8) & 0xFF;
        buf[2] = (dword >> 16) & 0xFF; buf[3] = (dword >> 24) & 0xFF;
    } else { /* current BE logic */ }
    return buf;
}
```
Export `setEndian`, `getEndian`.

### 2. `src/utils/BytecodeGenerator.js` — Scramble in randomRegister
Constructor: accept `registerScrambleMap` and `reverseScrambleMap` in options.

`randomRegister()` (line 249): after `this.reservedRegisters.add(register)`, apply scramble:
```js
if (this.registerScrambleMap) {
    const scrambled = this.registerScrambleMap.get(register);
    if (scrambled !== undefined) return scrambled;
}
return register;
```

`removeRegister(register)` (line ~220): if `reverseScrambleMap` exists, translate physical→logical before deleting from `reservedRegisters`.

### 3. `src/transpile.js` — Pipeline integration
**New option**: `options.polymorphic = options.polymorphic ?? true` (line ~724)

**In `virtualizeFunction`** (before generator creation):
1. Generate scramble map from integrity key seed
2. Choose endianness from integrity key seed
3. Call `setEndian(vmProfile.polyEndian)`
4. Pass scramble map to generator constructor
5. Scramble opaque scratch registers before passing to `insertOpaquePredicates`
6. Pass `polyEndian` to `applyControlFlowFlattening` and `insertOpaquePredicates`
7. Reset `setEndian("BE")` after each function

**Scramble map generation** — Fisher-Yates shuffle of `[3, registerCount-2]` seeded from integrity key:
```js
function buildRegisterScramble(registerCount, cffEnabled, seed) {
    const start = 3, end = cffEnabled ? registerCount - 1 : registerCount;
    const indices = Array.from({length: end - start}, (_, i) => start + i);
    // Seeded Fisher-Yates shuffle
    const rng = seededRNG(seed);
    for (let i = indices.length - 1; i > 0; i--) {
        const j = rng() % (i + 1);
        [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    const scrambleMap = new Map();
    const reverseMap = new Map();
    for (let i = 0; i < end - start; i++) {
        scrambleMap.set(start + i, indices[i]);
        reverseMap.set(indices[i], start + i);
    }
    return { scrambleMap, reverseMap };
}
```

**Endianness choice**: `(seedFromKey & 1) ? "LE" : "BE"`

### 4. `src/utils/cff.js` — Endian-aware dispatch buffer writes
Lines 401, 411-412 use `writeUInt32BE`/`writeInt32BE` directly. Change to accept `polyEndian` option and use LE variants when appropriate:
```js
const writeU32 = (polyEndian === "LE") ? "writeUInt32LE" : "writeUInt32BE";
const writeI32 = (polyEndian === "LE") ? "writeInt32LE" : "writeInt32BE";
dispatchData[writeU32](numEntries, 1);
dispatchData[writeU32](stateId, entryBase);
dispatchData[writeI32](offset, entryBase + 4);
```

Also update `getJumpEncodingOffsets` in transpile.js for CFF_DISPATCH: change `readUInt32BE(1)` to respect endianness.

### 5. `src/utils/opaquePredicates.js` — Endian-aware writeDWORD
`writeDWORD` helper (line 110): add endian parameter. `readDWORD` helper (line 106): add endian parameter. Thread `options.polyEndian` through from transpile.

### 6. `src/vm_dev.js` — LE readDWORD + polyEndian profile
- `normalizeVMProfile`: add `normalized.polyEndian = profile.polyEndian === "LE" ? "LE" : "BE"`
- `readDWORD()`: check `this.vmProfile.polyEndian` for LE byte order
- `readJumpTargetDWORD()`: use `readInt32LE` vs `readInt32BE` based on profile

### 7. `src/vm_dist.js` — Mirror vm_dev.js exactly
Same changes: normalizeVMProfile, readDWORD, readJumpTargetDWORD.

---

## Pipeline Order
1. Generate polymorphic config (scramble map + endianness) from integrity key
2. `setEndian(polyEndian)` on assembler
3. Create generator with scramble map
4. Generate bytecode (scrambled registers + correct endianness)
5. Macro fusion, dead code, CFF (all use endian-aware encodeDWORD)
6. Opaque predicates (endian-aware writeDWORD)
7. `obfuscateOpcodes` (shuffle opcode numbering)
8. Encoding passes (stateful, jump target, per-instruction) — XOR existing bytes, endian-neutral
9. Compress + encrypt
10. `setEndian("BE")` — reset

## Verification
1. `bun run test` — all existing tests pass
2. Test same source produces different bytecode with different integrity keys
3. Test execution correctness with LE endianness + scrambled registers
4. Test CFF + opaque predicates + polymorphic together
5. Test `polymorphic: false` produces BE output with no scrambling (backward compat)
