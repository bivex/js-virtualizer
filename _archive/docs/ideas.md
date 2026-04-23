# Ideas: Additional Protection Mechanisms

## Completed

### 1. Opaque Predicates ✅
Insert compile-time-known conditions that are non-obvious during static analysis. Always-true branches carry real code, always-false branches carry junk. Complicates symbolic execution and deobfuscation. Implemented in `src/utils/opaquePredicates.js`.

**CFF compatibility:** Opaque predicate insertion avoids splitting `SET` + `JUMP_UNCONDITIONAL` pairs that form CFF transition stubs, preserving correctness of state-machine transitions.

### 2. Control Flow Flattening at Bytecode Level ✅
Transform the VM dispatch loop into a finite state machine with a state variable. Each basic block becomes a case in a switch, transitions go through the state variable. Standard in commercial protectors (VMProtect, Themida). Implemented in `src/utils/cff.js`.

**setSizeFix:** State variable uses `LOAD_DWORD` instead of `SET` to avoid truncation issues and improve compatibility with anti-dump restoration. Ensures full 32-bit state preservation across VM boundaries.

**Option API:**
```js
await transpile(source, {
    controlFlowFlattening: true,  // default: true
});
```

### 3. Anti-Dump / Memory Scrubbing After Decryption ✅
Erase previous bytecode chunks after decryption. A memory dump at pause time yields incomplete/corrupted bytecode.

**Implemented in:** `src/vm_dev.js` + `src/vm_dist.js` (`enableAntiDump`, `scrubBytecodeRange`, `antiDumpBackup` backup + `restoreAntiDumpBytecodeRange` for backward jump restoration), `src/transpile.js` (`antiDump` option, key generation), `src/templates/functionWrapper.template` (`%ANTI_DUMP_SETUP%`), `src/utils/opcodes.js` (fork propagation).

**How it works:**
- On `loadFromString`, creates `antiDumpBackup` storing original bytes before any scrubbing
- Each executed instruction's bytecode is overwritten with seed-derived garbage (irreversible)
- A high-water mark tracks the furthest point reached — only scrubbing forward, never re-scrubbing already-scrubbed bytes
- On **backward jumps** (loops, CFF state transitions), `restoreAntiDumpBytecodeRange` restores code from backup before re-execution, ensuring correctness while still scrubbing after execution
- Fork (nested VM calls) inherits `antiDump` + `antiDumpSeed` and starts with a fresh high-water mark
- After VM finishes, the entire bytecode buffer is scrubbed — a memory dump yields only garbage

**Compatibility fixes:**
- ✅ **CFF integration:** `CFF_DISPATCH` added to jump opcode list so state-machine backward transitions also trigger restoration
- ✅ **Opaque predicates:** Predicate insertion avoids splitting `SET` + `JUMP_UNCONDITIONAL` pairs that form CFF transition stubs, preventing incorrect restoration triggers

**Option API:**
```js
await transpile(source, {
    opaquePredicates: true,  // default: true
});
```

**Backward compatibility:** `polymorphic: false` falls back to fixed big-endian ISA with no register scrambling.

### 4. Environmental Locking ✅
Bind execution to `window.location.hostname`, browser fingerprint, or environment hash. Bytecode simply does not execute in a different context.

**Implemented in:** `src/transpile.js` (hostname-based lock via `environmentLock` option), `src/templates/functionWrapper.template` (`%ENVIRONMENT_LOCK_SETUP%`).

**Browser fingerprint example with code interleaving:** The VM now includes `hashString` helper to fingerprint browser properties and interleaves dead instructions between real VM code, making extraction and analysis significantly harder.

**Option API:**
```js
await transpile(source, {
    environmentLock: {
        hostname: "example.com"
    }
});
```

**How it works:** The transpiler injects a runtime check that compares `window.location.hostname` (browser) or `os.hostname()` (Node) against the expected value. If mismatched, the VM silently produces garbage results instead of crashing (anti-tampering). The code interleaving spreads dead instructions throughout the VM body, further complicating analysis.

### 5. Code Interleaving (Function Merging) ✅
Merge bytecode from multiple virtualized functions into a single dispatch loop with separate state machines. Reversers cannot isolate individual functions. Implemented in `src/utils/codeInterleaving.js`, `src/transpile.js` (codeInterleaving option), `src/templates/interleavedSetup.template`, `src/templates/interleavedWrapper.template`.

**Option API:**
```js
await transpile(source, {
    codeInterleaving: true,  // default: false
});
```

### 6. Nested VM (Multi-Layer Virtualization)
Virtualize the VM itself or critical opcode handlers through a second VM. Classic commercial protector approach.

## Experimental

### 7. Junk Instructions In-Stream ✅
Interleaves dead instructions (LOAD_DWORD, LOAD_STRING, NOP, TEST, ADD) between real bytecode instructions. Uses high dead registers (registerCount-20 to registerCount-5) to avoid clobbering live values. No conditional jumps needed — junk executes harmlessly. Density: 6-10 instructions between insertions. Implemented in `src/utils/junkInStream.js`, integrated in `src/transpile.js`.

**Option API:**
```js
await transpile(source, {
    junkInStream: true,  // default: true
});
```

### 8. White-Box Key Encryption ✅
Replaces the simple XOR stream cipher with a T-table based construction. A 256-entry bijection lookup table (seeded from the encryption key) is generated per build. The T-table IS the key — extracting the original key from the table requires solving an underdetermined system. Decryption applies inverse T-table substitution + position-dependent XOR mask. T-tables are emitted as JS arrays in the VM source, making the key inseparable from the code. Implemented in `src/utils/whiteboxCipher.js`, `src/vm_dev.js` + `src/vm_dist.js` (whitebox decrypt in envelope unpacking).

**Option API:**
```js
await transpile(source, {
    whiteboxEncryption: true,  // default: true
});
```

### 9. Time-Lock / Proof-of-Work ✅
Before the dispatch loop starts, solve a hash-chain PoW challenge. The solution is mixed into `runtimeOpcodeState`, so skipping silently corrupts dispatch. Fixed ~12-bit difficulty (~50-200ms delay per invocation). Implemented in `src/utils/timeLock.js`, `src/vm_dev.js` + `src/vm_dist.js` (`enableTimeLock`, `solveTimeLockChallenge`).

**Option API:**
```js
await transpile(source, {
    timeLock: true,  // default: false
});
```

### 10. Dispatch Loop Obfuscation ✅
The `run()` loop is replaced with a phase-based state machine with indirect dispatch. Phase functions (FETCH, DECODE, PRE_EXEC, EXECUTE, POST) are stored in a shuffled array with dummy phases interleaved. The shuffle order is seeded per build. No readable `while(true)` pattern in output. Implemented in `src/utils/vmCommon.js` (`createDispatchObfuscationProfile`), `src/vm_dev.js` + `src/vm_dist.js` (`enableDispatchObfuscation`, phase handlers).

**Option API:**
```js
await transpile(source, {
    dispatchObfuscation: true,  // default: true
});
```

---

**Next priority:** Nested VM (item 6) — virtualize the VM itself through a second VM layer for critical opcode handlers.
