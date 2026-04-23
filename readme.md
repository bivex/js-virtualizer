# js-virtualizer

Virtualization-based obfuscation for JavaScript.

![Unit Tests](https://github.com/aesthetic0001/js-virtualizer/actions/workflows/tests.yml/badge.svg) ![npm downloads](https://img.shields.io/npm/dm/js-virtualizer) ![npm version](https://img.shields.io/npm/v/js-virtualizer) ![License](https://img.shields.io/npm/l/js-virtualizer) 

js-virtualizer transpiles selected JavaScript functions into custom bytecode and runs them inside a JavaScript VM. It is built for targeted function protection rather than whole-program virtualization.

## Quick Start

Install dependencies:

```bash
bun install
```

Run the test suite:

```bash
bun run test
```

Useful demo scripts:

- `bun run demo:fingerprint` - generates a Node.js fingerprint demo and prints previews of the obfuscated VM and virtualized output
- `bun run demo:fingerprint:browser` - generates a browser demo at `output/browser-fingerprint/index.html`

## Usage

> [!WARNING]  
> You need to mark the functions you want to virtualize by putting a comment with the text `// @virtualize` above the function.

```javascript
// @virtualize
function virtualize() {
  console.log("hello from the virtualized function");
}

function notVirtualized() {
  console.log("this function will not be virtualized");
}
```

> [!TIP]
> See [examples/basic.js](examples/basic.js) for a full example and the samples folder for some sample code you can try virtualizing.

```javascript
const {transpile} = require("js-virtualizer");

async function main() {
  const result = await transpile(`
    // @virtualize
    function virtualize() {
      console.log("hello world from the JSVM");
    }
    virtualize()
`, {
    fileName: 'example.js',
    writeOutput: true,
    vmOutputPath: "./vm_output.js",
    transpiledOutputPath: "./output.js",
    passes: [
      "RemoveUnused",
      "ObfuscateVM",
      "ObfuscateTranspiled"
    ],
    vmObfuscationTarget: "node",
    transpiledObfuscationTarget: "node"
  });

  console.log(`Virtualized code saved to: ${result.transpiledOutputPath}`);
}

main();
```

### Options for `transpile`

#### Output options

- `fileName` (string, default: `[randomly generated]`) - the filename of the code; will be used as the default output filename where the transpiled code & the VM will be written to
- `writeOutput` (bool, default `true`) - whether or not the transpiler should directly write the output to a file
- `vmOutputPath` (string, default: `output/[name].vm.js`) - the path to write the VM for the transpiled code to
- `transpiledOutputPath` (string, default: `output/[name].virtualized.js`) - the path to write the transpiled code to
- `vmObfuscationTarget` (string, default `node`) - javascript-obfuscator target for VM output when `ObfuscateVM` is enabled; use `"browser"` for browser-compatible output
- `transpiledObfuscationTarget` (string, default `node`) - javascript-obfuscator target for transpiled output when `ObfuscateTranspiled` is enabled

#### Protection features

All protection features default to `true` and are enabled simultaneously in the hardened default profile.

- `deadCodeInjection` (bool, default `true`) - append unreachable decoy bytecode instruction sequences to the protected payload
- `memoryProtection` (bool, default `true`) - enable encrypted register storage with guard tokens and per-step rotation; this is the primary performance bottleneck in the hardened profile
- `controlFlowFlattening` (bool, default `true`) - replace direct jumps with a state-machine dispatch loop (`CFF_DISPATCH` opcode), making control flow opaque to static analysis
- `opaquePredicates` (bool, default `true`) - insert always-true/false predicate blocks into the bytecode stream to confuse disassemblers
- `selfModifyingBytecode` (bool, default `true`) - scramble executed bytecode bytes after each instruction; backward jumps transparently restore the original bytes
- `antiDump` (bool, default `true`) - overwrite executed bytecode with a deterministic mask after execution, preventing memory dumps of the full payload
- `antiDebug` (enabled in wrappers by default) - arm timing-gap and DevTools heuristics that perturb dispatcher state and optionally trigger `debugger` traps when tampering is detected
- `timeLock` (bool, default `true`) - hashcash-style proof-of-work challenge solved at VM startup before execution begins
- `dispatchObfuscation` (bool, default `true`) - multi-phase dispatch loop (fetch, decode, pre-exec, execute, post, dummy) with interleaved dummy phases
- `junkInStream` (bool, default `true`) - insert junk instructions between real instructions in the bytecode stream
- `whiteboxEncryption` (bool, default `true`) - generate white-box T-tables for an additional bytecode encryption layer
- `polymorphic` (bool, default `true`) - randomize register scramble maps and endianness (BE/LE) per function based on the integrity key

#### VM profiles

- `randomizeVMProfiles` (bool, default `true`) - synthesize a hardened randomized register-VM profile per function; biased toward larger register files, denser decoys, and stronger dispatcher/alias strategies
- `vmProfile` (object, default `null`) - explicit VM profile override. Available sub-fields:
  - `registerCount` (number, 48–256) - number of VM registers
  - `dispatcherVariant` (`"permuted"` | `"clustered"` | `"striped"`) - dispatch table layout strategy
  - `aliasBaseCount` (number, 1–4) - base number of alias slots per opcode
  - `aliasJitter` (number, 0–3) - random alias count variation
  - `decoyCount` (number, 0–64) - number of decoy handler slots
  - `decoyStride` (number, 1–8) - spacing between decoy entries
  - `runtimeOpcodeDerivation` (`"hybrid"` | `"stateful"` | `"position"`) - how alias indices are selected at runtime
  - `polyEndian` (`"BE"` | `"LE"`) - endianness for DWORD encoding

#### Nested VM

- `nestedVM` (bool, default `false`) - enables two-layer virtualization; critical opcode handlers (ADD, FUNC_CALL, CFF_DISPATCH) are re-virtualized inside a lightweight 16-opcode inner VM with encrypted bytecode, shuffled opcode IDs, and per-function key derivation. Works with CFF, opaque predicates, dead code injection, and browser targets. Note: `nestedVM` + `codeInterleaving` is not yet supported.

#### Code interleaving

- `codeInterleaving` (bool, default `false`) - merge multiple `// @virtualize` functions into a single unified bytecode blob executed by one shared VM instance. The dispatch loop uses a selector register to switch between interleaved function bodies.

#### Environment lock

- `environmentLock` (object, default `null`) - restrict execution to a specific environment. Example: `{type: 'hostname', expected: 'example.com'}` — the VM verifies the runtime hostname before executing.

#### Preprocessing

- `decoratorsMode` (`"legacy"` | `"standard"`, default `"legacy"`) - Babel decorator plugin mode; `"standard"` uses the `2023-11` proposal syntax

#### Post-processing passes

- `passes` (array, default: `["RemoveUnused", "ObfuscateVM", "ObfuscateTranspiled"]`) - passes applied to the result before returning:
  - `RemoveUnused` - strip unused opcodes from the instruction set
  - `ObfuscateVM` - obfuscate the VM code through javascript-obfuscator
  - `ObfuscateTranspiled` - obfuscate the transpiled code through javascript-obfuscator

Generated virtualized wrappers protect embedded bytecode with a per-function integrity envelope. If the protected payload is modified, the VM throws before decompression and execution.

## Support Matrix

### Supported

| Area | Feature | Status | Notes |
| --- | --- | --- | --- |
| Variables | `let` / `const` scoping | ✅ | block scoping works |
| Variables | function-scoped `var` | ✅ | covered by regression tests |
| Variables | primitive literals | ✅ | strings, numbers, booleans, `null`, `undefined` |
| Variables | object expressions | ✅ | |
| Variables | array expressions | ✅ | |
| Variables | object destructuring | ✅ | |
| Variables | array destructuring | ✅ | |
| Variables | assignments | ✅ | includes compound assignment paths used by tests |
| Functions | arrow functions | ✅ | |
| Functions | function expressions | ✅ | |
| Functions | function declarations | ✅ | |
| Functions | generators / async generators | ✅ | supported through Babel preprocessing before Acorn parsing; direct functions and generator class methods are covered by regression tests |
| Functions | external/internal calls | ✅ | preserves `this` for method-style calls |
| Functions | callbacks | ✅ | |
| Functions | `this` inside virtualized functions | ✅ | top-level `this` and VM callbacks supported |
| Runtime | browser execution | ✅ | browser-aware `src/vm_dist.js` runs in browser-like runtimes without a compatibility wrapper; compressed payloads use `globalThis.pako.inflate` |
| Runtime | randomized register VM profiles | ✅ | wrappers embed hardened per-function VM profiles by default, biased toward larger register files plus stronger dispatcher/alias derivation strategies; explicit `vmProfile` overrides are supported |
| Async | `await` | ✅ | |
| Async | stored promises | ✅ | |
| Async | `Promise.all(...)` style concurrency | ✅ | child VM contexts prevent register clobbering |
| Async | full async surface | ✅ | async callbacks, nested helpers, and awaited `try` / `catch` / `finally` are covered by regression tests |
| Memory model | captured references in nested functions/protos | ✅ | escaped closures and prototype methods share captured state through nested VM contexts |
| Statements | `return` | ✅ | |
| Statements | `if` / `else if` / `else` | ✅ | |
| Statements | `for` | ✅ | |
| Statements | `for...of` | ✅ | |
| Statements | `for...in` | ✅ | |
| Statements | `while` | ✅ | |
| Statements | `switch` | ✅ | |
| Statements | `try` / `catch` / `finally` | ✅ | |
| Statements | `throw` | ✅ | |
| Statements | `continue` / `break` | ✅ | |
| Expressions | sequence expressions | ✅ | |
| Expressions | template literals | ✅ | |
| Expressions | ternaries | ✅ | |
| Expressions | logical operators (`&&`, `||`, `??`) | ✅ | includes nullish coalescing |
| Expressions | `new` | ✅ | |
| Expressions | unary operators | ✅ | includes `typeof`, `void`, `delete` |
| Expressions | binary operators | ✅ | |
| Expressions | update operators | ✅ | |
| Expressions | comparison operators | ✅ | both strict (`===`) and loose (`==`) equality |
| Expressions | bitwise operators | ✅ | `&`, `|`, `^`, `~`, `<<`, `>>` |
| Expressions | spread (`...`) | ✅ | spread into arrays and objects |
| Classes | class declarations | ✅ | implemented through desugaring |
| Classes | class expressions | ✅ | |
| Classes | getters / setters | ✅ | public and private |
| Classes | instance fields | ✅ | public and private |
| Classes | static fields | ✅ | public and private |
| Classes | private methods | ✅ | instance and static |
| Classes | static blocks | ✅ | public and private static member access covered |
| Classes | private brand checks (`#x in obj`) | ✅ | |
| Classes | computed class keys | ✅ | fields, methods, accessors, and computed `super[...]` calls |
| Classes | async methods | ✅ | public, private, static, and inherited cases covered |
| Classes | decorators | ✅ | supported through Babel preprocessing before Acorn parsing in both `legacy` and standard (`2023-11`) modes |
| Classes | inheritance | ✅ | |
| Classes | `super()` and `super.method()` | ✅ | constructor, instance, static method, and field initializer cases |
| Obfuscation | bytecode integrity checks | ✅ | protected bytecode envelopes detect payload tampering before decompression/execution |
| Obfuscation | argument scrambling | ✅ | virtualized wrappers and internal VM callbacks load arguments through randomized aliases/order mappings |
| Obfuscation | string encryption | ✅ | bytecode string payloads are encrypted before embedding and decoded inside the VM at load time |
| Obfuscation | dead code injection | ✅ | transpiled bytecode gets unreachable decoy instruction tails by default |
| Obfuscation | junk instruction insertion | ✅ | junk instructions are inserted between real instructions in the bytecode stream |
| Obfuscation | opaque predicates | ✅ | always-true/false predicate blocks confuse disassemblers and static analysis |
| Obfuscation | VM memory protection | ✅ | generated wrappers enable protected register storage with on-read restoration |
| Obfuscation | register rotation (stack-lane encoding) | ✅ | protected register wrappers rotate on protected reads/writes and after each VM step to avoid stable stored values |
| Obfuscation | dispatcher-level indirect dispatch | ✅ | VM instances resolve decoded opcodes through a shuffled dispatch table instead of direct handler lookup |
| Obfuscation | dispatcher variants | ✅ | `permuted`, `clustered`, and `striped` dispatch table layouts; randomized per function |
| Obfuscation | decoy opcode handlers | ✅ | the shuffled dispatcher includes fake never-called handler slots in addition to the real opcode aliases |
| Obfuscation | runtime opcode derivation | ✅ | decoded opcodes resolve through runtime-selected alias slots driven by evolving dispatcher state (`hybrid`, `stateful`, or `position` modes) |
| Obfuscation | macro opcodes / superinstructions | ✅ | common traces such as paired literal loads and test+jump sequences are fused into synthesized macro-opcodes |
| Obfuscation | whole-bytecode encryption with externalized runtime key | ✅ | virtualized wrappers embed only a key id; the actual bytecode decryption keys are registered in the generated VM runtime |
| Obfuscation | white-box T-table encryption | ✅ | additional white-box cipher layer with generated T-table lookup tables |
| Obfuscation | stateful / position-dependent opcodes | ✅ | opcode bytes are encoded by byte position and decoded at runtime using a per-function seed derived from the integrity key |
| Obfuscation | per-instruction bytecode encoding | ✅ | protected instruction payload bytes are decoded just-in-time during VM execution using a per-function seed |
| Obfuscation | jump target encoding | ✅ | control-flow offsets are encoded inside protected payloads and decoded only by the VM at execution time |
| Obfuscation | control-flow flattening | ✅ | direct jumps replaced with a state-machine dispatch loop, making control flow opaque to static analysis |
| Obfuscation | self-modifying bytecode | ✅ | executed bytecode bytes are scrambled after each instruction; backward jumps transparently restore original bytes |
| Obfuscation | anti-dump | ✅ | executed bytecode is overwritten with a deterministic mask, preventing memory dumps of the full payload |
| Obfuscation | polymorphic endianness and register scramble | ✅ | random BE/LE endianness and register index scrambling per function based on integrity key |
| Obfuscation | dedicated VM anti-debug layer | ✅ | VM instances can arm timing-gap and DevTools heuristics that perturb dispatcher state and optionally trigger debugger traps |
| Obfuscation | dispatch loop obfuscation | ✅ | multi-phase dispatch (fetch, decode, pre-exec, execute, post, dummy) with interleaved dummy phases |
| Obfuscation | time-lock / proof-of-work | ✅ | hashcash-style PoW challenge solved at VM startup before execution begins |
| Obfuscation | code interleaving | ✅ | multiple virtualized functions merged into a single unified bytecode blob with shared VM instance |
| Obfuscation | environment lock | ✅ | restrict execution to specific hostnames or environments |
| Obfuscation | bytecode compression | ✅ | bytecode payloads are zlib/pako compressed before embedding and decompressed at load time |
| Nested VM | two-layer virtualization | ✅ | critical handlers (ADD, FUNC_CALL, CFF_DISPATCH) are re-virtualized inside a 16-opcode inner VM with encrypted bytecode and shuffled opcode IDs |
| Nested VM | inner opcode shuffle | ✅ | inner VM opcode IDs are permuted per-function, preventing static analysis of the inner instruction set |
| Nested VM | CFF dispatch through inner VM | ✅ | the control-flow flattening state machine is itself virtualized, hiding dispatch logic from reverse engineering |
| Nested VM | browser support | ✅ | nested VM works in browser environments (Node.js and browser targets) |
| Runtime | automatic top-level initializer virtualization | ✅ | safe top-level variable initializers are auto-wrapped into helper VMs without requiring `// @virtualize` markers |

## Performance

js-virtualizer adds measurable overhead. The table below comes from a synthetic hot-loop benchmark (`compute(50000)`, 10 calls per run, 3 runs) to give a worst-case picture.

| Mode | Avg per call | Slowdown vs original |
| --- | --- | --- |
| Original JS | 0.16 ms | 1x |
| Light VM | 34 ms | ~213x |
| Hardened VM (default) | 234 ms | ~1475x |
| Hardened VM + nested VM | 264 ms | ~1660x |
| Hardened VM, `memoryProtection: false` | 113 ms | ~714x |
| Hardened VM, `memoryProtection: false` + nested VM | 148 ms | ~929x |

`memoryProtection` uses array-backed storage with dirty-bit tracking — only registers that were written to since the last step are re-protected, instead of all 253 registers every step. Nested VM adds only ~13% overhead on top of the hardened profile since `memoryProtection` overhead is now minimal.

> [!NOTE]
> These numbers are a worst case. A tight compute loop is the scenario most hostile to any VM. For functions that do I/O, DOM work, or infrequent business logic the relative slowdown is much smaller. Benchmark on real project code before deciding which profile to use.

## Limitations

> [!WARNING]  
> It is highly recommended that you modify **and** obfuscate the [vm_dist.js](src/vm_dist.js) file before using it in a production environment. For instance, including the opcode names in the VM makes it more trivial to reverse engineer the workings of the virtualized code

- performance is not guaranteed. js-virtualizer is not intended for high-performance paths or whole-program virtualization; it is better suited to protecting selected functions where slowdown is acceptable
- the distributed VM is still realistically reversible if shipped as-is. Obfuscating or hardening the VM runtime is still recommended for production use
- anti-analysis layers are still heuristic rather than bulletproof. Integrity checks, keyed payload encryption, jump-target encoding, indirect/derived dispatch, macro-op fusion, dead code, anti-debug heuristics, and protected register storage raise the bar, but they do not make the VM equivalent to a commercial protector
- automatic top-level initializer virtualization is intentionally conservative. Safe initializer shapes are virtualized automatically, while complex runtime-heavy initializers stay as plain JavaScript to avoid semantic or temp-register regressions
- syntax outside the support matrix, especially proposal-era or otherwise untested constructs, may still fail even when nearby standardized syntax works
