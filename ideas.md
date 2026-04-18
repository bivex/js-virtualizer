# Ideas: Additional Protection Mechanisms

## Completed

### 1. Opaque Predicates ✅
Insert compile-time-known conditions that are non-obvious during static analysis. Always-true branches carry real code, always-false branches carry junk. Complicates symbolic execution and deobfuscation. Implemented in `src/utils/opaquePredicates.js`.

### 2. Control Flow Flattening at Bytecode Level ✅
Transform the VM dispatch loop into a finite state machine with a state variable. Each basic block becomes a case in a switch, transitions go through the state variable. Standard in commercial protectors (VMProtect, Themida). Implemented in `src/utils/cff.js`.

### 4. Self-Modifying Bytecode ✅
Bytecode mutates itself during execution — upcoming instructions decode only after preceding ones execute. Kills memory dumps and static disassemblers. Implemented in `src/vm_dev.js` + `src/vm_dist.js`.

---

## Completed

### 3. Polymorphic VM ✅

Generate a fundamentally different instruction set architecture per build. Each build requires separate reverse engineering. Defeats automated devirtualizers that target a fixed ISA.

**Implemented in:** `src/transpile.js` (`buildRegisterScramble`, `polyEndian` derivation), `src/utils/BytecodeGenerator.js` (register scramble map), `src/utils/opaquePredicates.js` (poly-aware), `src/utils/cff.js` (polyEndian), `src/vm_dev.js` + `src/vm_dist.js` (runtime endian/encoding support).

**What varies per build:**

| Axis | Implementation | Effect |
|---|---|---|
| Register scrambling | Per-build scramble map derived from integrity key seed | Register 5 in source → scrambled physical index |
| Immediate encoding | BE or LE endianness derived from integrity key parity | DWORD values stored differently per build |
| VM profile | Random register count (96–256), dispatcher variant, alias counts, decoy slots | Each function gets unique VM configuration |
| Opcode encoding | Stateful + position-based + per-instruction byte encoding | Same opcode has different bytes at different positions |
| Jump target encoding | Seed-derived jump target obfuscation | Jump offsets are encrypted per-build |
| Opaque scratch registers | Scrambled through poly map | Predicate registers differ per build |
| Dead code | Random decoy sequences with per-build register selection | Bait instructions use different registers |

**Option API:**
```js
await transpile(source, {
    polymorphic: true,  // default: true
});
```

**Backward compatibility:** `polymorphic: false` falls back to fixed big-endian ISA with no register scrambling.

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

**Next priority:** Anti-Dump / Memory Scrubbing (item 5) is the next high-impact feature. Combined with polymorphism, memory scrubbing would mean that even a live memory dump yields incomplete or corrupted bytecode — reversers get neither a static ISA nor a complete dump.
