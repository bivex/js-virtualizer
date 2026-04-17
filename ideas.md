# Ideas: Additional Protection Mechanisms

## High Priority

### 1. Opaque Predicates
Insert compile-time-known conditions that are non-obvious during static analysis. Always-true branches carry real code, always-false branches carry junk. Complicates symbolic execution and deobfuscation.

### 2. Control Flow Flattening at Bytecode Level
Transform the VM dispatch loop into a finite state machine with a state variable. Each basic block becomes a case in a switch, transitions go through the state variable. Standard in commercial protectors (VMProtect, Themida).

### 3. Polymorphic VM (Different ISA Per Build)
Generate a different instruction set architecture per build: vary opcode semantics, operand order, register file size, endianness. Each build requires separate reverse engineering. Defeats automated devirtualizers that target a fixed ISA.

### 4. Self-Modifying Bytecode
Bytecode mutates itself during execution — upcoming instructions decode only after preceding ones execute. Kills memory dumps and static disassemblers.

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

**Biggest wins:** opaque predicates + bytecode-level CFF + self-modifying bytecode. These three make manual reversing an order of magnitude harder and are the foundation of commercial protectors. Polymorphic VM defends against automated devirtualizers targeting a fixed ISA.
