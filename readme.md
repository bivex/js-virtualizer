# js-virtualizer

virtualization-based obfuscation for javascript

---

![Unit Tests](https://github.com/aesthetic0001/js-virtualizer/actions/workflows/tests.yml/badge.svg) ![npm downloads](https://img.shields.io/npm/dm/js-virtualizer) ![npm version](https://img.shields.io/npm/v/js-virtualizer) ![License](https://img.shields.io/npm/l/js-virtualizer) 

js-virtualizer is a proof-of-concept project which brings virtualization-based obfuscation to javascript. In this implementation, bytecode is fed to a virtual machine implemented in javascript which runs on its own instruction set. A transpiler is included to convert select **functions** to opcodes for the VM. It is important to note that js-virtualizer is **not intended for use on entire programs, but rather for specified functions**! There will be a significant performance hit if you try to run an entire program through the VM.

## Usage

Install dependencies with `bun install`, then run tests with `bun run test`.

Useful demo scripts:

- `bun run demo:fingerprint` - generates a Node.js fingerprint demo and prints previews of the obfuscated VM and virtualized output
- `bun run demo:fingerprint:browser` - generates a browser demo at `output/browser-fingerprint/index.html`

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
      "ObfuscateVM", // whether or not to obfuscate the VM code through js-confuser
      "ObfuscateTranspiled" // whether or not to obfuscate the transpiled code through js-confuser
    ]
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
- `passes` (array, default: `["RemoveUnused", "ObfuscateVM", "ObfuscateTranspiled"]`) - an array of passes to apply to the result before returning and writing to a file
  - `RemoveUnused` - whether or not to remove unused opcodes from the instruction set
  - `ObfuscateVM` - whether or not to obfuscate the VM code through js-confuser
  - `ObfuscateTranspiled` - whether or not to obfuscate the transpiled code through js-confuser

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
| Functions | external/internal calls | ✅ | preserves `this` for method-style calls |
| Functions | callbacks | ✅ | |
| Functions | `this` inside virtualized functions | ✅ | top-level `this` and VM callbacks supported |
| Async | `await` | ✅ | |
| Async | stored promises | ✅ | |
| Async | `Promise.all(...)` style concurrency | ✅ | child VM contexts prevent register clobbering |
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
| Classes | inheritance | ✅ | |
| Classes | `super()` and `super.method()` | ✅ | constructor, instance, and static method cases |

### Partially Supported

| Area | Feature | Status | Notes |
| --- | --- | --- | --- |
| Runtime | browser execution | ⚠️ | browser demo works via compatibility wrapper around [`src/vm_dist.js`](src/vm_dist.js) |
| Async | full async surface | ⚠️ | core concurrency works, but async path is less battle-tested than the sync path |
| Memory model | captured references in nested functions/protos | ⚠️ | correctness works in common cases, but reference counting / cleanup is still incomplete |

### Unsupported

| Area | Feature | Status | Notes |
| --- | --- | --- | --- |
| Classes | decorators | ❌ | blocked by the current `acorn` parser setup, which does not parse `@decorator` syntax |
| Classes | remaining advanced class syntax | ❌ | mostly narrowed to decorators, parser-level proposals, and untested proposal-era edge cases |
| Obfuscation | argument scrambling | ❌ | not implemented |
| Obfuscation | string encryption | ❌ | not implemented |
| Obfuscation | dead code injection | ❌ | not implemented |
| Obfuscation | VM memory protection | ❌ | register encryption / JIT restore not implemented |
| Obfuscation | bytecode integrity checks | ❌ | not implemented |

## Limitations

> [!WARNING]  
> It is highly recommended that you modify **and** obfuscate the [vm_dist.js](src/vm_dist.js) file before using it in a production environment. For instance, including the opcode names in the VM makes it more trivial to reverse engineer the workings of the virtualized code

- this project primarily targets server-side javascript runtimes such as node.js. a browser demo is included, but browser usage still relies on a compatibility wrapper around `vm_dist.js`
- async support now covers awaited calls, stored promises, `Promise.all`, and nested async virtualized functions. it is still less battle-tested than the synchronous path and may expose edge cases in more exotic async/control-flow combinations
- performance is not guaranteed. js-virtualizer is not intended for use in high-performance applications. it is intended for use in applications where you need to protect your code from reverse engineering. For instance, an express server with a virtualized function using for loops handled about 50% of the requests of the non-virtualized counterpart. You can find the implementation in the samples folder and test it out for yourself
- given the virtual machine, the virtualized function is pretty trivial to reverse engineer. it is recommended that the virtual machine class is obfuscated before use
- opcode shuffling/minification exists, but deeper obfuscation layers are still incomplete
