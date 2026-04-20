# Nested VM — Implementation Status & Blockers

## Date
2026-04-21

## Summary
Nested VM feature (item 6 in ideas.md) is **~90% complete**. Core infrastructure (InnerVM runtime, ADD/FUNC_CALL virtualization, inner opcode shuffle, CFF trampoline) is implemented and tests mostly pass. One critical injection bug prevents CFF from working; two test brittleness issues.

---

## Completed Components ✅

| Component | Status | Notes |
|-----------|--------|-------|
| InnerVM runtime class | ✅ | 16 opcodes, shuffled handlers array, `run()`, `patchByte/DWORD` |
| Inner opcode definitions | ✅ | `innerOpcodes.js`: 16 ops, operand sizes |
| Inner bytecode compilers | ✅ | `compileAddInnerBytecode()`, `compileFuncCallInnerBytecode()`, `compileCffInnerRaw()` |
| Inner opcode shuffle | ✅ | `shuffleInnerOpcodes()`, `remapInnerBytecode()` applied to all inner bytecode |
| Inner bytecode encryption | ✅ | XOR with `nestedKey`, stored as hex in `InnerVM.programs` |
| Trampolines (ADD/FUNC_CALL) | ✅ | Replace outer handlers, patch inner bytecode, run InnerVM |
| CFF_DISPATCH trampoline | ✅ | Reads outer CFF data, calls InnerVM with per-function inner CFF bytecode |
| Non-interleaved mode | ✅ | Per-function inner CFF compiled, injected via wrapper placeholder |
| Interleaved mode | ✅ | Merged CFF inner compiled, injected into all wrappers |
| Template placeholders | ✅ | `%CFF_INNER_PROGRAM%` in both wrapper templates |

---

## Known Issues / Blockers 🚫

### 1. Critical: CFF Inner Hex Not Injected into Wrapper (Failing Test)
**Test:** `nested VM virtualizes CFF_DISPATCH` → throws `Error: CFF inner program missing`

**Root cause:** The wrapper template's `%CFF_INNER_PROGRAM%` placeholder is being replaced with an empty string because `entry._cffInnerHex` is undefined at replacement time.

**Why:**
- `entry._cffInnerHex` is set in a loop that runs **after** trampoline AST replacement but **before** `rewriteQueue.forEach`.
- The `rewriteQueue.forEach` correctly checks `result.includes("%CFF_INNER_PROGRAM%")` and attempts replacement using `entry._cffInnerHex`.
- However, the `_cffInnerHex` property may not be set on the specific entry used by the CFF test because the compilation loop iterates `rewriteQueue` and sets it, but perhaps the condition `options.controlFlowFlattening !== false` is evaluated again inside the forEach? No, that's fine.

Investigation: The compilation loop is:
```js
if (options.controlFlowFlattening !== false) {
    for (const entry of rewriteQueue) { ... }
}
```
This executes **after** the handlerMap block and **before** the `rewriteQueue.forEach`. Should set `_cffInnerHex`.

Possible reasons:
- For the failing test, `options.controlFlowFlattening` is explicitly `true` — condition passes.
- `entry.chunk.code.find(op => op.name === 'CFF_DISPATCH')` might return `undefined` because the opcode name got obfuscated/remapped earlier? Obfuscation runs **after** CFF application and **before** per-function CFF compilation. Let's check order:
  - In `virtualizeFunction`, after CFF is applied, we later (line 1027-1032) insert opaque predicates. Then we exit virtualizeFunction without obfuscating.
  - Obfuscation (`obfuscateOpcodes`) runs **later** on the chunks **after** all functions are virtualized and (for interleaved) merged, but for non-interleaved it runs in the `forEach` on each chunk? Actually `obfuscateOpcodes` is called inside `virtualizeFunction` only for interleaved? Let's check:
    - Non-interleaved: `virtualizeFunction` does **not** call `obfuscateOpcodes`; it just returns the generator chunk.
    - Later, in main flow after `virtualizeFunction` calls, we have:
      ```js
      if (options.passes.has("RemoveUnused") && !rewriteQueue._ilvObfuscated) {
          obfuscateOpcodes(chunks, vmAST)
      }
      ```
      That runs **before** we get to nestedVM block. So yes, opcodes are remapped before nestedVM compilation. That means `op.name` is still the original name (remapping changes `opcode.opcode` numeric value but preserves `.name`). So `find(op => op.name === 'CFF_DISPATCH')` should still work. Good.

- Could it be that `cffOp.data` is undefined because CFF_DISPATCH's data is on `cffOp` as `cffOp.data` Buffer? Yes.

So perhaps the problem is that `compileCffInnerRaw` expects `cffAbsPos` to be the absolute position within the chunk, but we compute it by summing `op.toBytes().length`. That gives correct position.

But maybe `compileCffInnerRaw` returned something but we stored on entry? Yes we set `entry._cffInnerHex = ...`. That should persist.

Let's add console.log to debug? Not now. Instead, verify that the wrapper template replacement happens. Maybe the wrapper template used in `virtualizeFunction` does **not** contain `%CFF_INNER_PROGRAM%` because we modified `functionWrapper.template` after initial load? But we did update it. Need to ensure that when `virtualizeFunction` creates `virtualizedFunction`, it uses the **latest** template from disk (loaded at module init). Since we edited the file after `transpile.js` was already required in the running Jest process, we need to **restart** Jest between changes. Running tests again after edits should pick up new template because Node requires are cached. Jest may have cached the old template content from previous test run. We should clear Jest cache or restart. The current run did show `InnerVM` present, so template changes may be loaded. But to be safe, we'll note to clear cache.

Most likely the issue is that the CFF compilation loop runs **after** we've already replaced the placeholder? Let's examine ordering more carefully.

**Current flow:**

1. `virtualizeFunction(node, sharedConfig)` is called for each node (either individually or in sharedConfig interleaved case).
   - Inside, it builds wrapper string using `functionWrapperTemplate` (which contains `%CFF_INNER_PROGRAM%`).
   - Pushes `rewriteQueue` entry with `result: virtualizedFunction` (the wrapper string) at the end.

2. After all `virtualizeFunction` calls, we handle interleaving if enabled. That removes interleaved entries from `rewriteQueue`. Good.

3. Then we hit the big `if (options.nestedVM && rewriteQueue.length > 0) { ... }` block.
   - This block does:
     a) Derive keys, shuffle, generate InnerVM AST, inject.
     b) Compile ADD/FUNC_CALL inner bytecode, encrypt, inject programs into AST.
     c) Inject `InnerVM.buildCffProgram` builder (unused) and decrypt method.
     d) **Replace outer handlers** via `findImplOpcodeObject` → modifies `handlerMap` properties with trampoline functions (this modifies the AST `vmAST`).
     e) **Close** the `if (handlerMap)` block (ends at line ~1632 in our current view).
     f) **Then** run the CFF compilation loop over `rewriteQueue` to compute `entry._cffInnerHex`.
     g) Then exit outer nestedVM block.

4. Later: `rewriteQueue.forEach(entry => { ... })` runs.
   - Inside forEach:
     - Compute encodings, apply to chunk.
     - Then check `if (result.includes("%CFF_INNER_PROGRAM%"))` to replace with `VM._cffInnerHex = '...'` using `entry._cffInnerHex`.
     - Then substitute `%BYTECODE%`, parse, and patch `node.body.body`.

Thus the CFF hex should be present on each entry before replacement.

**Potential gotcha:** The `result` string we check is the original wrapper string stored in `entry.result`. That string has `%CFF_INNER_PROGRAM%`. We replace it with `VM._cffInnerHex = '...'` only if `entry._cffInnerHex` exists. Does it exist for all entries? For non-interleaved single functions with CFF enabled, yes we set it in step 3f. However, note that `if (options.controlFlowFlattening !== false)` condition is used both in step 1 (inside virtualizeFunction for CFF on each chunk) and step 3f. In step 3f we also have that condition, so it's consistent.

Now, what about the test "nested VM virtualizes CFF_DISPATCH"? It uses `controlFlowFlattening: true` (explicit). So condition passes. We should get `_cffInnerHex`.

Maybe the compilation loop doesn't find CFF_DISPATCH in `entry.chunk.code` because after CFF is applied, the opcode might be a different name? No, it's still CFF_DISPATCH.

Wait: Look at `applyControlFlowFlattening` output: It creates a new chunk with new opcodes. The opcode names are standard ones including `CFF_DISPATCH`. Good.

What about `cffOp.data`? It should be a Buffer. The compilation reads data using `readUInt32LE/BE` on the Buffer. That's fine.

Could `compileCffInnerRaw` return `undefined`? No, it returns hex string.

Maybe the compilation loop is not executing because we placed it **inside** the `if (handlerMap)` block accidentally due to brace misplacement. Let's check the structure around line 1550. The closing brace of `if (handlerMap)` is at line 1632 in our current view. But the compilation block is at line 1550 which is **inside** that `if (handlerMap)` block! Indeed in the snippet we saw earlier, lines 1540-1563 show:
```js
if (handlerMap) {
    // Replace outer handlers...
    function findImplOpcodeObject(...) { ... }
    const handlerMap = findImplOpcodeObject(vmAST);
    if (handlerMap) {
        // replace handlers...
    }

    // Compile per-function CFF inner bytecode (raw) before encoding
    if (options.controlFlowFlattening !== false) {
        for (const entry of rewriteQueue) { ... }
    }
}
```
So the compilation block is **nested inside** the outer `if (handlerMap)` block. That means if `handlerMap` is `null` (i.e., we didn't find the `implOpcode` object in the AST for some reason), the entire block, including CFF compilation, is skipped! That's the bug. The CFF compilation must happen regardless of whether `handlerMap` was found, because it sets `_cffInnerHex` used later. But if `handlerMap` is not found (which happens if something wrong), then we never set it. But actually our tests show InnerVM class is present, so handlerMap should be found. But maybe handlerMap is found but the code block is still inside, but that's okay. However we observed `_cffInnerHex` undefined, so perhaps the CFF compilation block is not reached because of a misplaced brace earlier causing it to be inside a different block that doesn't execute? Let's re-examine the actual braces.

Better: We should move the CFF compilation **outside** of the entire `if (handlerMap)` block, after it closes. That is, after line 1632 (closing brace of `if (handlerMap)`), but before the closing brace of the outer `if (options.nestedVM ...)` which ends at line 1633? Actually line 1633 shows `}` after that block. Let's check snippet:

Line 1540: `if (handlerMap) {`
...
Line 1632: `}` (closes `if (handlerMap)`)
Line 1633: `}` (closes outer `if (options.nestedVM ...)`? Actually line 1633 is `}` which likely closes the outer block. Then line 1634 is blank and line 1635 starts `rewriteQueue.forEach`. So that suggests the outer block closed before forEach. But our CFF compilation block we placed at line 1550 is inside handlerMap. If we want it outside, we need to move it after line 1632.

Let's re-open the file segment to see exact brace layout.
</think>
<tool_call>
<function=read>