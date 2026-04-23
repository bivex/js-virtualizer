# Nested VM Implementation — Current State (After Fixes)

## What's Working ✅

### Core Features
- **InnerVM runtime** with 16 opcodes (shuffled handler order)
- **ADD and FUNC_CALL handlers** fully virtualized via InnerVM
- **Inner opcode shuffle** activated (`shuffleInnerOpcodes` → `remapInnerBytecode`)
- **Inner bytecode encryption** using `nestedKey`
- **CFF_DISPATCH trampoline** replaced with InnerVM-based execution
- **Per-function CFF inner bytecode** compiled and injected
- **Non-interleaved** and **interleaved** modes supported

### Code Locations
- `src/utils/innerVmCodegen.js` — generates InnerVM class with shuffled handlers
- `src/utils/innerBytecodeCompiler.js` — `compileCffInnerRaw()` (new), remap/encrypt
- `src/transpile.js:1423-1633` — nestedVM injection block
  - Lines 1427-1428: derive `remap` from shuffle seed
  - Lines 1446-1453: remap ADD/FUNC_CALL bytecode
  - Lines 1550-1563: **per-function CFF inner compilation** (moved outside handlerMap block)
  - Lines 1564-1625: trampolines for ADD/FUNC_CALL/CFF_DISPATCH
  - Lines 1635-1648: placeholder replacement for CFF inner hex
- Templates: `%CFF_INNER_PROGRAM%` in both functionWrapper and interleavedWrapper

## Known Issues ⚠️

### 1. CFF Inner Program Not Set on VM Instance (Failing)
**Symptom:** Test `"nested VM virtualizes CFF_DISPATCH"` fails with `Error: CFF inner program missing` from trampoline.

**Root cause:** The per-function CFF inner bytecode is compiled and stored in `entry._cffInnerHex`, but it's not being assigned to the VM instance before `VM.run()`.

In non-interleaved mode, wrapper template does:
```js
const VM = new __JSV_RUNTIME(...);
VM.loadFromString(...);
%RUNCMD%;  // <-- VM.run() called here
```

But `%CFF_INNER_PROGRAM%` (which should inject `VM._cffInnerHex = '...'`) is **empty** because the replacement happens **after** the wrapper body has already been patched into AST (line 1647 replaces in `result`, but `result` was already used to patch `node.body.body` at line 1641 in previous logic flow?).

**Fix needed:** Ensure `_cffInnerHex` is injected into wrapper **before** AST parsing, and that the assignment happens in the wrapper body before `VM.run()`.

**Actual flow:**
1. `virtualizeFunction()` creates wrapper string with `%CFF_INNER_PROGRAM%` placeholder
2. That wrapper string is parsed to AST and assigned to `node.body.body` (line ~1132)
3. Later, per-function CFF hex is computed and stored in `entry._cffInnerHex`
4. Then in `rewriteQueue.forEach`, `result` (original wrapper string) is modified to replace placeholder → but this `result` is not the same string used to patch the AST earlier!

**Solution approach:** Instead of modifying `result` after AST patch, directly inject the assignment into the wrapper AST **after** CFF hex is known, or store CFF hex on the node and modify the AST node's body just before final generation.

Alternative: Move CFF inner bytecode compilation **into** `virtualizeFunction()` so the wrapper template replacement happens before AST patch.

### 2. Shuffle Test Fragility
**Test:** `"nested VM shuffle changes InnerVM handlers order"`
- Extracts `this.handlers` array from generated VM code using regex
- Fails because regex doesn't match (handlers array spans multiple lines with embedded newlines)
- Need multiline regex or better extraction (e.g., match content between brackets including newlines)

## Implementation Gaps ❌

### CFF Inner Bytecode Compilation Placement
Currently `compileCffInnerRaw()` is called in `rewriteQueue.forEach` **after** all outer encodings are applied. This works for extracting raw bytes but:
- The `cffAbsPos` must be computed correctly (it is)
- However, the offset decoding using `JSVM.encodeJumpTargetBytes` may be incorrect because encodings are already applied to the chunk — but we're reading raw opcode data which has **not yet been encoded**. That's correct: we compute inner bytecode from **pre-encoding** state. Good.

### Inner VM Builders Duplication
`InnerVM.buildCffProgram` builder is still injected into AST but unused. Can be removed if not needed.

## Test Results (Latest Run)
- **Passed:** 11/13
  - All sample files (sum, branching, patterns, conditional, switch)
  - InnerVM class presence
  - Arithmetic output
  - Function calls
  - All protections combined
  - Disabled check
- **Failed:**
  1. CFF_DISPATCH inner execution (missing `_cffInnerHex` assignment)
  2. Code interleaving (same root cause + maybe merged CFF not injected)
  3. Shuffle extraction test (regex brittle)

## Next Steps to Complete Nested VM

1. **Fix CFF inner hex injection** (critical):
   - Move CFF inner compilation to happen **inside** `virtualizeFunction()` before wrapper AST is built, or
   - After computing `entry._cffInnerHex`, modify the AST node's body to insert `VM._cffInnerHex = '...'` right after `VM.loadFromString(...)` and before `VM.loadDependencies/run`
   - Ensure both regular and interleaved modes get the assignment

2. **Fix shuffle test**:
   - Use `/this\.handlers\s*=\s*\[([\s\S]*?)\]/m` or check for specific handler presence via code structure

3. **Code interleaving CFF**:
   - Once per-function injection fixed, merged mode should work automatically (merged CFF hex already set on all wrappers via `mergedCffInnerHex`)

4. **Cleanup**:
   - Remove unused `InnerVM.buildCffProgram` injection if not needed
   - Remove commented legacy code

## Files Modified in This Session
- `src/utils/innerVmCodegen.js`
- `src/transpile.js`
- `src/templates/functionWrapper.template`
- `src/templates/interleavedWrapper.template`
- `tests/nested_vm.test.js`

