# Ideas: Additional Protection Mechanisms

## Completed

### 1. Opaque Predicates ✅
Insert compile-time-known conditions that are non-obvious during static analysis. Always-true branches carry real code, always-false branches carry junk. Complicates symbolic execution and deobfuscation. Implemented in `src/utils/opaquePredicates.js`.

### 2. Control Flow Flattening at Bytecode Level ✅
Transform the VM dispatch loop into a finite state machine with a state variable. Each basic block becomes a case in a switch, transitions go through the state variable. Standard in commercial protectors (VMProtect, Themida). Implemented in `src/utils/cff.js`.

### 4. Self-Modifying Bytecode ✅
Bytecode mutates itself during execution — upcoming instructions decode only after preceding ones execute. Kills memory dumps and static disassemblers. Implemented in `src/vm_dev.js` + `src/vm_dist.js`.

---

## High Priority

### 3. Polymorphic VM (Different ISA Per Build)

Generate a fundamentally different instruction set architecture per build. Each build requires separate reverse engineering. Defeats automated devirtualizers that target a fixed ISA.

**Current state:** js-virtualizer already randomizes VM profiles per function (register count, dispatcher variant, alias counts, decoy slots, derivation mode). But the ISA itself — opcode assignments, operand encoding, and handler semantics — is structurally identical across builds. A reverser who maps one build can reuse that knowledge on another.

**What changes per build under polymorphism:**

| Axis | What varies | Effect |
|---|---|---|
| Opcode assignment | `opNames` → shuffled number space | Opcode 0x03 means ADD in one build, JUMP in another |
| Operand order | `[dest, src]` vs `[src, dest]` | Disassembler must know the per-build convention |
| Register encoding | Register indices scrambled by per-build map | Register 5 in bytecode = physical register 47 |
| Instruction width | Variable-length encoding (1–6 byte opcodes) | Cannot linearly sweep bytecode |
| Immediate encoding | Big-endian, little-endian, or byte-rotated | DWORD values stored differently per build |
| Handler structure | Handler bodies reordered, wrapped in indirection | Pattern-matching on handler code fails across builds |

#### Implementation Plan

##### Phase 1: Opcode Reassignment

File: `src/utils/polymorphic.js` (new)

```js
function buildPolymorphicISA(seed) {
    const rng = createSeededRNG(seed);

    // Shuffle opcode number assignment
    const shuffled = rng.shuffle([...Array(opNames.length).keys()]);

    // Build bidirectional maps
    const nameToOpcode = {};  // "ADD" → 47
    const opcodeToName = {};  // 47 → "ADD"
    opNames.forEach((name, i) => {
        nameToOpcode[name] = shuffled[i];
        opcodeToName[shuffled[i]] = name;
    });

    return { nameToOpcode, opcodeToName };
}
```

- During transpile, `BytecodeGenerator` uses `nameToOpcode` instead of the fixed `opcodes` map
- During runtime, the VM dispatch table is built from `opcodeToName` (embedded in the profile)
- The shuffled mapping is embedded in the VM profile JSON, not in the handler code
- Profile serialization: `{ polyOpcodeMap: { "ADD": 47, "LOAD_DWORD": 3, ... } }`

**Files to modify:**
- `src/utils/BytecodeGenerator.js` — accept opcode map override
- `src/transpile.js` — generate polymorphic ISA per function, embed in profile
- `src/vm_dist.js` + `src/vm_dev.js` — build dispatch from profile map instead of fixed indices
- `src/utils/constants.js` — keep `opNames` as canonical name list, decouple from numeric IDs

##### Phase 2: Operand Order Permutation

Per-opcode operand order is shuffled per build.

```js
// For each opcode that takes [dest, src, ...], define a permutation
const operandPermutations = {
    "ADD": rng.shuffle([0, 1, 2]),  // e.g. [src, dest, src2]
    "SET": rng.shuffle([0, 1]),
    // opcodes with fixed semantics (JUMP, END) skip permutation
};
```

- The generator emits operands in the permuted order
- The VM handler reads operands in the same permuted order (driven by profile)
- Profile field: `polyOperandOrder: { "ADD": [2, 0, 1], ... }`

##### Phase 3: Register Index Scrambling

```js
function buildRegisterScramble(registerCount, rng) {
    const map = rng.shuffle([...Array(registerCount).keys()]);
    return {
        logicalToPhysical: map,    // logical 0 → physical 47
        physicalToLogical: map.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]).map(([, i]) => i)
    };
}
```

- Bytecode uses logical register indices (0, 1, 2...)
- At load time, VM translates via the scramble map embedded in the profile
- Scramble is derived from the integrity key seed — no separate key needed
- Profile field: `polyRegisterMap: [47, 3, 12, ...]`

##### Phase 4: Variable-Length Opcodes

Replace fixed 1-byte opcode prefix with variable-length encoding:

```
1-byte opcodes: [0x00..0x7F]           (128 opcodes)
2-byte opcodes: [0x80 marker][byte]    (256 additional)
```

- Build selects which opcodes get 1-byte vs 2-byte encoding randomly
- VM reads first byte; if high bit set, reads second byte
- Profile field: `polyOpcodeWidth: { "ADD": 1, "CFF_DISPATCH": 2, ... }`

##### Phase 5: Immediate Encoding Variation

Per-build DWORD encoding:

```js
const encodingVariant = rng.choice(["BE", "LE", "ROTATED"]);
// BE: standard big-endian
// LE: little-endian
// ROTATED: byte-rotated (rotate left by 1 byte)
```

- Applied to all DWORD immediates: jump offsets, LOAD_DWORD values, CFF state IDs
- VM decoder reads DWORDs using the profile-specified variant
- Profile field: `polyEndian: "LE"`

#### Integration Points

**Transpile pipeline** (add after profile generation):
```
1. generatePolymorphicISA(profileSeed)
2. → BytecodeGenerator uses poly opcode map + operand order
3. → BytecodeGenerator uses poly register scramble (or applied at encoding)
4. → Immediate encoding uses poly endian
5. Profile JSON includes all polymorphic params → embedded in output
```

**VM runtime** (at init, before dispatch table build):
```
1. Read poly params from profile
2. Build dispatch table using opcodeToName map
3. Install operand order per handler
4. Apply register scramble map
5. Set DWORD reader to correct endian variant
```

**Option API:**
```js
await transpile(source, {
    polymorphic: true,            // enable all polymorphic transforms (default: true)
    polymorphicSeed: "my-key",    // optional: deterministic seed for reproducible builds
    polymorphicOptions: {
        opcodeReassignment: true,
        operandPermutation: true,
        registerScrambling: true,
        variableLengthOpcodes: false,  // phase 4, off by default initially
        immediateEncoding: true,
    }
});
```

#### Backward Compatibility

- `polymorphic: false` falls back to current fixed ISA
- Profiles without `polyOpcodeMap` use the original `opcodes` map
- Existing `vmProfile` override still works — polymorphic transforms layer on top

#### Testing Strategy

1. Unit test: generate 50 random seeds, transpile + execute same source, assert identical output
2. Verify different seeds produce different bytecode byte sequences
3. Verify same seed produces identical bytecode (reproducibility)
4. Existing test suite passes with `polymorphic: true`
5. Verify dispatch table differs between builds for the same source

#### Security Impact

| Attack | Before | After |
|---|---|---|
| Static disassembly | Map opcode names once, reuse | Must re-map per build |
| Devirtualizer tooling | Target fixed ISA | ISA changes per build, tool breaks |
| Pattern matching | `0x05` = always JUMP_EQ | `0x05` = different op each build |
| Register tracing | Logical = physical | Logical indices scramble to physical |
| DWORD extraction | Fixed BE encoding | Endian varies per build |

---

## Medium Priority

### 5. Anti-Dump / Memory Scrubbing After Decryption
Erase previous bytecode chunks after decryption. A memory dump at pause time yields incomplete/corrupted bytecode.

### 6. Environmental Locking
Bind execution to `window.location.hostname`, browser fingerprint, or environment hash. Bytecode simply does not execute in a different context.

### 7. Nested VM (Multi-Layer Virtualization)
Virtualize the VM itself or critical opcode handlers through a second VM. Classic commercial protector approach.

### 8. Code Interleaving (Function Merging)
Merge bytecode from multiple virtualized functions into a single dispatch loop with separate state machines. Reversers cannot isolate individual functions.

## Experimental

### 9. Junk Instructions In-Stream
Not just dead code tails — interleave junk instructions between real ones that don't affect results but complicate tracing.

### 10. White-Box Key Encryption
Replace the current XOR cipher with a white-box AES/construction where the key is inseparable from the decryption code.

### 11. Time-Lock / Proof-of-Work
Bytecode contains a built-in computational delay that cannot be accelerated. Protects against automated brute-force analysis.

### 12. Dispatch Loop Obfuscation
The `run()` loop is relatively readable. Run it through control flow flattening + indirect calls to make the dispatch mechanism itself harder to analyze.

---

**Next priority:** Polymorphic VM is the single highest-impact remaining feature. It makes all other protections more effective because every build has a unique ISA — reversers cannot build reusable devirtualizer tooling. The phased approach (opcode reassignment first, then operand/register/encoding) allows incremental rollout with each phase independently testable.
