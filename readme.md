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

## Transpiler Support

- [x] variables
  - [x] proper scoping for let and const
  - [x] function-scoped `var`
  - [x] all primitive types
  - [x] object expressions
  - [x] array expressions
  - [x] object destructuring
  - [x] array destructuring
  - [x] assignment
- [ ] functions
  - [x] arrow functions
  - [x] function expressions
  - [x] function declarations
  - [x] function calls (both external and internal) with proper `this` context
  - [x] callbacks
  - [x] awaiting functions
  - [x] concurrent async flows across the virtualized function, including stored promises and `Promise.all`
  - [x] a function accessing its own `this` property
- [x] other statements
  - [x] return statements
  - [x] if/else/else if statements
  - [x] for loops
  - [x] for of loops
  - [x] for in loops
  - [x] while loops
  - [x] switch cases
  - [x] try/catch/finally
  - [x] throw statements
  - [x] continue statements
  - [x] break statements
- [x] misc
  - [x] sequence expressions
  - [x] template literals
  - [x] ternary operators
  - [x] logical operators
  - [x] new expressions
  - [x] class declarations and class expressions
  - [x] class getters and setters
  - [x] class fields and static fields
  - [x] inheritance and `super`
  - [x] unary operators (typeof, delete, etc.)
  - [x] binary operators
  - [x] update operators
  - [x] comparison operators
  - [x] bitwise operators

## Limitations

> [!WARNING]  
> It is highly recommended that you modify **and** obfuscate the [vm_dist.js](src/vm_dist.js) file before using it in a production environment. For instance, including the opcode names in the VM makes it more trivial to reverse engineer the workings of the virtualized code

- this project primarily targets server-side javascript runtimes such as node.js. a browser demo is included, but browser usage still relies on a compatibility wrapper around `vm_dist.js`
- async support now covers awaited calls, stored promises, `Promise.all`, and nested async virtualized functions. it is still less battle-tested than the synchronous path and may expose edge cases in more exotic async/control-flow combinations
- performance is not guaranteed. js-virtualizer is not intended for use in high-performance applications. it is intended for use in applications where you need to protect your code from reverse engineering. For instance, an express server with a virtualized function using for loops handled about 50% of the requests of the non-virtualized counterpart. You can find the implementation in the samples folder and test it out for yourself
- given the virtual machine, the virtualized function is pretty trivial to reverse engineer. it is recommended that the virtual machine class is obfuscated before use
- class support currently covers class declarations, class expressions, getters/setters, class fields, static fields, inheritance, and `super`. private fields and decorator-style features are still outside the supported set

## Todo

- [x] transpiler
- [x] provide a proper `this` property to functions
- [x] proper `var` support
- [x] template literals
- [x] proper for and while loops
- [x] sequence expressions
- [x] object and array destructuring
- [x] arrow functions
- [x] object expressions
- [x] callbacks
- [x] basic class declaration support
- [x] try/catch/finally
- [ ] proper reference counting to manage variables captured by protos (functions declared within functions) and other data types which are passed by reference (objects, arrays, etc.)
  - currently, any captured variables do not get dropped by the transpiler and persist in memory, even when going out of scope
  - need to add a way to check for references to both variables which store protos as well as the variables which are captured by protos
  - once no more references to the proto exist, all variables captured by the proto should be dropped (assuming they have no other references; there should be a counter for the number of references to captured variables)
- [x] add support for async functions in the context of the whole function
- [ ] extend class support to private fields, decorators, and remaining advanced class syntax
- [ ] obfuscation passes/optimization passes
- [ ] obfuscation techniques
  - [x] opcode shuffling and minification (remove unused opcodes, rename opcodes, etc.)
  - [ ] argument scrambling (change the order of arguments in function calls)
  - [ ] string encryption
  - [ ] dead code injection
  - [ ] VM memory protection (encrypt data in the registers and restore it just in time. this should probably be done mostly by the VM)
  - [ ] bytecode integrity checks
