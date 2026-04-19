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

## Completed

### 5. Anti-Dump / Memory Scrubbing After Decryption ✅
Erase previous bytecode chunks after decryption. A memory dump at pause time yields incomplete/corrupted bytecode.

**Implemented in:** `src/vm_dev.js` + `src/vm_dist.js` (`enableAntiDump`, `scrubBytecodeRange`, high-water-mark tracking), `src/transpile.js` (`antiDump` option, key generation), `src/templates/functionWrapper.template` (`%ANTI_DUMP_SETUP%`), `src/utils/opcodes.js` (fork propagation).

**How it works:**
- Each executed instruction's bytecode is overwritten with seed-derived garbage (irreversible)
- A high-water mark tracks the furthest point reached — only scrubbing forward, never re-scrubbing already-scrubbed bytes
- On backward jumps (loops), `restoreBytecodeRange` restores code from backup, then re-execution scrubs it again
- Fork (nested VM calls) inherits `antiDump` + `antiDumpSeed` and starts with a fresh high-water mark
- After VM finishes, the entire bytecode buffer is scrubbed — a memory dump yields only garbage

**Option API:**
```js
await transpile(source, {
    antiDump: true,  // default: true
});
```

---

### 6. Environmental Locking ✅
Bind execution to `window.location.hostname`, browser fingerprint, or environment hash. Bytecode simply does not execute in a different context.

**Implemented in:** `src/transpile.js` (hostname-based lock via `environmentLock` option), `src/templates/functionWrapper.template` (`%ENVIRONMENT_LOCK_SETUP%`).

**Option API:**
```js
await transpile(source, {
    environmentLock: {
        hostname: "example.com"
    }
});
```

**How it works:** The transpiler injects a runtime check that compares `window.location.hostname` (browser) or `os.hostname()` (Node) against the expected value. If mismatched, the VM silently produces garbage results instead of crashing (anti-tampering).

---

## Medium Priority

### 7. Nested VM (Multi-Layer Virtualization)
Virtualize the VM itself or critical opcode handlers through a second VM. Classic commercial protector approach.

### 8. Code Interleaving (Function Merging)
Merge bytecode from multiple virtualized functions into a single dispatch loop with separate state machines. Reversers cannot isolate individual functions.

## Experimental

### 9. Junk Instructions In-Stream
Not just dead code tails — interleave junk instructions between real ones that don't affect results but complicate tracing.

### 10. White-Box Key Encryption
Replace the current XOR cipher with a white-box AES/construction where the key is inseparable from the decryption code.

### 11. Time-Lock / Proof-of-Work ✅
Before the dispatch loop starts, solve a hash-chain PoW challenge. The solution is mixed into `runtimeOpcodeState`, so skipping silently corrupts dispatch. Fixed ~12-bit difficulty (~50-200ms delay per invocation). Implemented in `src/utils/timeLock.js`, `src/vm_dev.js` + `src/vm_dist.js` (`enableTimeLock`, `solveTimeLockChallenge`).

**Option API:**
```js
await transpile(source, {
    timeLock: true,  // default: false
});
```

### 12. Dispatch Loop Obfuscation ✅
The `run()` loop is replaced with a phase-based state machine with indirect dispatch. Phase functions (FETCH, DECODE, PRE_EXEC, EXECUTE, POST) are stored in a shuffled array with dummy phases interleaved. The shuffle order is seeded per build. No readable `while(true)` pattern in output. Implemented in `src/utils/vmCommon.js` (`createDispatchObfuscationProfile`), `src/vm_dev.js` + `src/vm_dist.js` (`enableDispatchObfuscation`, phase handlers).

**Option API:**
```js
await transpile(source, {
    dispatchObfuscation: true,  // default: true
});
```

---

**Next priority:** Nested VM (item 7) — virtualize the VM itself through a second VM layer for critical opcode handlers.
