 Nested VM Implementation Plan                                                                                                                                                                                                             
                                                                                                                                                                                                                                           
 Context                                                                                                                                                                                                                                   
                                                                                                                                                                                                                                           
 Add a second VM layer where critical opcode handlers (ADD, FUNC_CALL, CFF_DISPATCH) are themselves virtualized. The outer VM's dispatch loop calls trampolines that execute inner VM bytecode instead of direct JS handlers. This makes   
 reverse engineering exponentially harder since the handler logic is not visible as JavaScript.                                                                                                                                            

 Architecture

 Outer JSVM.run()
   -> reads opcode (e.g. ADD)
   -> resolveOpcodeHandler() returns trampoline
   -> trampoline:
        1. Pre-reads operands from outer bytecode (readByte etc)
        2. Patches inner bytecode with operand values
        3. Runs InnerVM.run()
        4. Inner VM reads/writes outer registers via I_READ_OUTER/I_WRITE_OUTER

 Inner VM: 16 opcodes, fixed 16 registers, no dispatch table, no encoding layers. Concrete JS handlers (no recursion). Security from encrypted bytecode + shuffled inner opcode IDs + obfuscation pass.

 Inner Opcode Set (16)

 ┌─────┬───────────────┬──────────────────────────┬─────────────────────────┐
 │ ID  │     Name      │         Operands         │       Description       │
 ├─────┼───────────────┼──────────────────────────┼─────────────────────────┤
 │ 0   │ I_LOAD_BYTE   │ inner_reg, byte          │ Load immediate byte     │
 ├─────┼───────────────┼──────────────────────────┼─────────────────────────┤
 │ 1   │ I_LOAD_DWORD  │ inner_reg, dword(4)      │ Load immediate DWORD    │
 ├─────┼───────────────┼──────────────────────────┼─────────────────────────┤
 │ 2   │ I_READ_OUTER  │ inner_reg, outer_reg     │ Read outer VM register  │
 ├─────┼───────────────┼──────────────────────────┼─────────────────────────┤
 │ 3   │ I_WRITE_OUTER │ outer_reg, inner_reg     │ Write outer VM register │
 ├─────┼───────────────┼──────────────────────────┼─────────────────────────┤
 │ 4   │ I_ADD         │ dest, left, right        │ Integer add             │
 ├─────┼───────────────┼──────────────────────────┼─────────────────────────┤
 │ 5   │ I_SUBTRACT    │ dest, left, right        │ Integer subtract        │
 ├─────┼───────────────┼──────────────────────────┼─────────────────────────┤
 │ 6   │ I_XOR         │ dest, left, right        │ Bitwise XOR             │
 ├─────┼───────────────┼──────────────────────────┼─────────────────────────┤
 │ 7   │ I_AND         │ dest, left, right        │ Bitwise AND             │
 ├─────┼───────────────┼──────────────────────────┼─────────────────────────┤
 │ 8   │ I_SHL         │ dest, left, right        │ Shift left              │
 ├─────┼───────────────┼──────────────────────────┼─────────────────────────┤
 │ 9   │ I_EQ          │ dest, left, right        │ Equality test (1/0)     │
 ├─────┼───────────────┼──────────────────────────┼─────────────────────────┤
 │ 10  │ I_JZ          │ test_reg, offset(2)      │ Jump if zero            │
 ├─────┼───────────────┼──────────────────────────┼─────────────────────────┤
 │ 11  │ I_CALL        │ dest, fn, this, args_arr │ JS function call        │
 ├─────┼───────────────┼──────────────────────────┼─────────────────────────┤
 │ 12  │ I_READ_PROP   │ dest, obj, prop          │ Property access         │
 ├─────┼───────────────┼──────────────────────────┼─────────────────────────┤
 │ 13  │ I_ARR_READ    │ dest, arr, idx           │ Array index read        │
 ├─────┼───────────────┼──────────────────────────┼─────────────────────────┤
 │ 14  │ I_NOP         │ -                        │ No-op                   │
 ├─────┼───────────────┼──────────────────────────┼─────────────────────────┤
 │ 15  │ I_END         │ -                        │ Halt                    │
 └─────┴───────────────┴──────────────────────────┴─────────────────────────┘

 Virtualized Handlers

 ADD (simple arithmetic pattern)

 Original: this.write(this.readByte(), this.read(this.readByte()) + this.read(this.readByte()))
 Trampoline: pre-read dest/left/right regs -> inner VM reads outer regs, adds, writes result
 Inner bytecode:
   I_READ_OUTER r3, {left_reg}    ; read left value
   I_READ_OUTER r4, {right_reg}   ; read right value
   I_ADD r5, r3, r4               ; compute
   I_WRITE_OUTER {dest_reg}, r5   ; write result
   I_END

 FUNC_CALL (external function call)

 Original: reads fn/dst/funcThis/args registers, calls fn.apply(funcThis, args)
 Trampoline: pre-read all operand regs -> inner VM reads outer regs, builds args array, calls, writes result
 Inner bytecode:
   I_READ_OUTER r0, {fn_reg}        ; get function
   I_READ_OUTER r1, {this_reg}      ; get this
   I_LOAD_BYTE r2, {args_count}     ; args count
   ; loop: read each arg register
   I_CALL r3, r0, r1, r_args        ; call fn.apply(this, args)
   I_WRITE_OUTER {dst_reg}, r3      ; write result
   I_END

 CFF_DISPATCH (control flow state machine)

 Original: reads state register, scans entry pairs (state + offset), jumps on match
 Trampoline: pre-read stateReg, numEntries -> inner VM scans entries via loop
 Inner bytecode:
   I_READ_OUTER r0, {stateReg}     ; current state
   I_LOAD_DWORD r1, {numEntries}   ; entry count
   ; loop: read entry state + offset, compare, jump
   I_END

 Key Management

 - nestedKey = createSeedFromString('nested:' + integrityKey, 0x3c2b1a09)
 - Inner bytecode XOR-encrypted: byte ^ ((nestedKey ^ (position * 17)) & 0xFF)
 - Inner opcode shuffle seed: createSeedFromString('inner-shuffle:' + integrityKey, 0x5a4b3c2d)
 - Derived at runtime from outer bytecodeIntegrityKey — no extra stored keys

 Files to Create

 1. src/utils/innerOpcodes.js — Inner opcode name table (16 entries), inner opcodes enum
 2. src/utils/innerBytecodeCompiler.js — Compiles handler logic to inner bytecode buffers (compileAddInnerBytecode(), compileFuncCallInnerBytecode(), compileCffDispatchInnerBytecode())
 3. src/utils/innerVmCodegen.js — Generates InnerVM JS class source as string for AST injection
 4. tests/nested_vm.test.js — Tests for nested VM functionality

 Files to Modify

 1. src/transpile.js — Add nestedVM option (default false). When enabled, after obfuscateOpcodes:
   - Generate inner bytecode for each selected handler
   - Derive nested key, encrypt inner bytecodes
   - Inject InnerVM class into vmAST (parse generated source, append before JSVM class)
   - Replace ADD/FUNC_CALL/CFF_DISPATCH handlers in implOpcode with trampolines
   - Shuffle inner opcode IDs with separate seed
 2. src/utils/vmCommon.js — Add deriveNestedKey(integrityKey) helper
 3. src/postTranspilation/obfuscateOpcodes.js — Extend to shuffle inner opNames with separate seed when nestedVM enabled

 Implementation Order

 1. Create innerOpcodes.js (opcode table)
 2. Create innerVmCodegen.js (InnerVM class source generator)
 3. Create innerBytecodeCompiler.js (ADD handler first)
 4. Add deriveNestedKey to vmCommon.js
 5. Modify transpile.js: add option, inject InnerVM, ADD trampoline only
 6. Test ADD works with nestedVM: true
 7. Add FUNC_CALL inner compiler + trampoline
 8. Add CFF_DISPATCH inner compiler + trampoline
 9. Add inner bytecode encryption + opcode shuffle
 10. Create tests/nested_vm.test.js
 11. Run full test suite to verify no regressions

 Verification

 - nestedVM: false (default): all 207 existing tests pass unchanged
 - nestedVM: true: all sample files produce matching runtime output
 - bun test tests/nested_vm.test.js — dedicated nested VM tests
 - Full suite: bun test — 0 regressions
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
