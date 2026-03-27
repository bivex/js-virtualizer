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
    // the filename of the code; will be used as the default output filename
    fileName: 'example.js',
    // whether or not the transpiler should directly write the output to a file
    writeOutput: true,
    // the path to write the vm for the transpiled code to
    vmOutputPath: "./vm_output.js",
    // the path to write the transpiled code to
    transpiledOutputPath: "./output.js",
    // the passes apply to the result before returning
    passes: [
      "RemoveUnused", // whether or not to remove unused opcodes from the instruction set
      "ObfuscateVM", // whether or not to obfuscate the VM code through javascript-obfuscator
      "ObfuscateTranspiled" // whether or not to obfuscate the transpiled code through javascript-obfuscator
    ],
    // optional javascript-obfuscator targets for each output kind
    vmObfuscationTarget: "node",
    transpiledObfuscationTarget: "node"
  });

  console.log(`Virtualized code saved to: ${result.transpiledOutputPath}`);
}

main();
```
### Options for `transpile`

- `fileName` (string, default: `[randomly generated]`) - the filename of the code; will be used as the default output filename where the transpiled code & the VM will be written to
- `writeOutput` (bool, default `true`) - whether or not the transpiler should directly write the output to a file
- `vmOutputPath` (string, default: `node_modules/js-virtualizer/output/[name].js`) - the path to write the vm for the transpiled code to
- `transpiledOutputPath` (string, default: `node_modules/js-virtualizer/output/[name].virtualized.js`) - the path to write the transpiled code to
- `deadCodeInjection` (bool, default `true`) - whether or not unreachable decoy bytecode should be appended to the protected payload
- `memoryProtection` (bool, default `true`) - whether or not generated wrappers should enable protected VM register storage before execution
- `randomizeVMProfiles` (bool, default `true`) - whether or not each virtualized function should synthesize a hardened randomized register-VM profile; the default random path now biases toward larger register files, denser decoys, and stronger dispatcher/alias strategies
- `vmProfile` (object, default `null`) - optional explicit VM profile override; useful when you want to pin `registerCount`, dispatcher variant, alias policy, or opcode-derivation mode
- `vmObfuscationTarget` (string, default `node`) - javascript-obfuscator target for VM output when `ObfuscateVM` is enabled
- `transpiledObfuscationTarget` (string, default `node`) - javascript-obfuscator target for transpiled output when `ObfuscateTranspiled` is enabled
- `passes` (array, default: `["RemoveUnused", "ObfuscateVM", "ObfuscateTranspiled"]`) - an array of passes to apply to the result before returning and writing to a file
  - `RemoveUnused` - whether or not to remove unused opcodes from the instruction set
  - `ObfuscateVM` - whether or not to obfuscate the VM code through javascript-obfuscator
  - `ObfuscateTranspiled` - whether or not to obfuscate the transpiled code through javascript-obfuscator

Generated virtualized wrappers now protect embedded bytecode with a per-function integrity envelope. If the protected payload is modified, the VM throws before decompression and execution.
Generated virtualized wrappers also enable protected register storage and dead bytecode injection by default.

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
| Expressions | logical operators | ✅ | |
| Expressions | `new` | ✅ | |
| Expressions | unary operators | ✅ | includes `typeof` and `delete` |
| Expressions | binary operators | ✅ | |
| Expressions | update operators | ✅ | |
| Expressions | comparison operators | ✅ | |
| Expressions | bitwise operators | ✅ | |
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
| Obfuscation | VM memory protection | ✅ | generated wrappers enable protected register storage with on-read restoration |
| Obfuscation | dispatcher-level indirect dispatch | ✅ | VM instances resolve decoded opcodes through a shuffled dispatch table instead of direct handler lookup |
| Obfuscation | whole-bytecode encryption with externalized runtime key | ✅ | virtualized wrappers embed only a key id; the actual bytecode decryption keys are registered in the generated VM runtime |
| Obfuscation | stateful / position-dependent opcodes | ✅ | opcode bytes are encoded by byte position and decoded at runtime using a per-function seed derived from the integrity key |
| Obfuscation | jump target encoding | ✅ | control-flow offsets are encoded inside protected payloads and decoded only by the VM at execution time |
| Obfuscation | decoy opcode handlers | ✅ | the shuffled dispatcher includes fake never-called handler slots in addition to the real opcode aliases |
| Obfuscation | macro opcodes / superinstructions | ✅ | common traces such as paired literal loads and test+jump sequences are fused into synthesized macro-opcodes |
| Obfuscation | runtime opcode derivation | ✅ | decoded opcodes resolve through runtime-selected alias slots driven by evolving dispatcher state |
| Obfuscation | dedicated VM anti-debug layer | ✅ | VM instances can arm timing-gap and DevTools heuristics that perturb dispatcher state and optionally trigger debugger traps |
| Obfuscation | per-instruction bytecode encoding | ✅ | protected instruction payload bytes are decoded just-in-time during VM execution using a per-function seed |
| Obfuscation | stack-lane encoding equivalent | ✅ | protected register wrappers rotate on protected reads/writes and after each VM step to avoid stable stored values |
| Runtime | automatic top-level initializer virtualization | ✅ | safe top-level variable initializers are auto-wrapped into helper VMs without requiring `// @virtualize` markers |

## Performance

js-virtualizer adds measurable overhead. The table below comes from a synthetic hot-loop benchmark (`compute(50000)`, 10 calls per run, 3 runs) to give a worst-case picture.

| Mode | Avg per run | Avg per call | Slowdown vs original |
| --- | --- | --- | --- |
| Original JS | 1.221 ms (0.001 s) | 0.122 ms (0.0001 s) | 1x |
| Light VM | 1075.581 ms (1.076 s) | 107.558 ms (0.108 s) | ~881x |
| Hardened VM (default) | 15902.526 ms (15.903 s) | 1590.252 ms (1.590 s) | ~13024x |
| Hardened VM, `memoryProtection: false` | ~1083–1153 ms (~1.083–1.153 s) | ~108–115 ms (~0.108–0.115 s) | ~888x |

**Bottleneck:** nearly all overhead in the hardened default profile comes from `memoryProtection`, not from profile randomization. Profiler self-time with the default profile:

| Function | Self-time |
| --- | --- |
| `rotateProtectedRegisters` | 6929 ms |
| `createProtectedRegisterValue` | 6360 ms |
| `restoreProtectedRegisterValue` | 2271 ms |
| `runAntiDebugSweep` | 547 ms |

Disabling `memoryProtection` (and `deadCodeInjection`) brings the hardened profile back to roughly the same cost as the light VM.

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
