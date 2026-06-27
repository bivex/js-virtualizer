/**
 * Copyright (c) 2026 Bivex
 *
 * Author: Bivex
 * Available for contact via email: support@b-b.top
 * For up-to-date contact information:
 * https://github.com/bivex
 *
 * Created: 2026-03-26 18:54
 * Last Updated: 2026-03-26 18:54
 *
 * Licensed under the MIT License.
 * Commercial licensing available upon request.
 */

const path = require("node:path");
const fs = require("node:fs");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const babel = require("@babel/core");
const decoratorsPlugin = require("@babel/plugin-proposal-decorators");

const {transpile} = require("../src/transpile");

function toRunnableSource(code, decoratorsMode = "legacy") {
    try {
        new Function(code);
        return code;
    } catch (error) {
        if (!(error instanceof SyntaxError)) {
            throw error;
        }
    }

    const transformed = babel.transformSync(code, {
        configFile: false,
        babelrc: false,
        comments: true,
        retainLines: true,
        sourceType: "module",
        plugins: [[decoratorsPlugin, decoratorsMode === "standard" ? {version: "2023-11"} : {legacy: true}]]
    });

    if (!transformed || !transformed.code) {
        throw new Error("Failed to build runnable decorator source");
    }

    return transformed.code;
}

async function transpileAndRun(code, label, transpileOptions = {}) {
    const slug = `${label}-${crypto.randomBytes(4).toString("hex")}`;
    const inputPath = path.join(__dirname, `../output/${slug}.source.js`);
    const vmOutputPath = path.join(__dirname, `../output/${slug}.vm.js`);
    const transpiledOutputPath = path.join(__dirname, `../output/${slug}.virtualized.js`);

    const decoratorsMode = transpileOptions.decoratorsMode ?? "legacy";
    fs.writeFileSync(inputPath, toRunnableSource(code, decoratorsMode));

    const result = await transpile(code, {
        fileName: `${slug}.js`,
        vmOutputPath,
        transpiledOutputPath,
        passes: ["RemoveUnused"],
        ...transpileOptions
    });

    const originalOutput = childProcess.execSync(`node ${inputPath}`).toString();
    const virtualizedOutput = childProcess.execSync(`node ${result.transpiledOutputPath}`).toString();

    return {
        originalOutput,
        virtualizedOutput
    };
}

describe("previously unsupported behavior", () => {
    test("supports function-scoped var across blocks", async () => {
        const code = `
const container = {
  value: 0,
  run() {
    // @virtualize
    function demo() {
      if (true) {
        var token = 41;
      }
      return token + 1;
    }
    return demo();
  }
};
console.log(container.run());
`;

        const {originalOutput, virtualizedOutput} = await transpileAndRun(code, "var-block");
        expect(virtualizedOutput).toBe(originalOutput);
        expect(virtualizedOutput.trim()).toBe("42");
    });

    test("supports top-level this access in virtualized functions", async () => {
        const code = `
const probe = {
  prefix: "fp",
  salt: 17,
  // @virtualize
  read() {
    return this.prefix + ":" + this.salt;
  }
};
console.log(probe.read());
`;

        const {originalOutput, virtualizedOutput} = await transpileAndRun(code, "this-access");
        expect(virtualizedOutput).toBe(originalOutput);
        expect(virtualizedOutput.trim()).toBe("fp:17");
    });

    test("supports class declarations inside virtualized functions", async () => {
        const code = `
// @virtualize
function demo() {
  class FingerprintBox {
    constructor(prefix, value) {
      this.prefix = prefix;
      this.value = value;
    }

    render() {
      return this.prefix + ":" + this.value;
    }
  }

  const box = new FingerprintBox("fp", 23);
  return box.render();
}

console.log(demo());
`;

        const {originalOutput, virtualizedOutput} = await transpileAndRun(code, "class-declaration");
        expect(virtualizedOutput).toBe(originalOutput);
        expect(virtualizedOutput.trim()).toBe("fp:23");
    });

    test("supports class expressions inside virtualized functions", async () => {
        const code = `
// @virtualize
function demo() {
  const FingerprintBox = class {
    constructor(prefix, value) {
      this.prefix = prefix;
      this.value = value;
    }

    render() {
      return this.prefix + ":" + this.value;
    }
  };

  const box = new FingerprintBox("expr", 29);
  return box.render();
}

console.log(demo());
`;

        const {originalOutput, virtualizedOutput} = await transpileAndRun(code, "class-expression");
        expect(virtualizedOutput).toBe(originalOutput);
        expect(virtualizedOutput.trim()).toBe("expr:29");
    });

    test("supports class getters and setters inside virtualized functions", async () => {
        const code = `
// @virtualize
function demo() {
  class FingerprintBox {
    constructor() {
      this._value = 0;
    }

    get value() {
      return "v:" + this._value;
    }

    set value(next) {
      this._value = next + 1;
    }
  }

  const box = new FingerprintBox();
  box.value = 8;
  return box.value;
}

console.log(demo());
`;

        const {originalOutput, virtualizedOutput} = await transpileAndRun(code, "class-accessors");
        expect(virtualizedOutput).toBe(originalOutput);
        expect(virtualizedOutput.trim()).toBe("v:9");
    });

    test("supports class fields and static fields inside virtualized functions", async () => {
        const code = `
// @virtualize
function demo() {
  class FingerprintBox {
    prefix = "field";
    value = 11;
    static kind = "static";
    static salt = 5;

    render() {
      return this.prefix + ":" + this.value + ":" + FingerprintBox.kind + ":" + FingerprintBox.salt;
    }
  }

  return new FingerprintBox().render();
}

console.log(demo());
`;

        const {originalOutput, virtualizedOutput} = await transpileAndRun(code, "class-fields");
        expect(virtualizedOutput).toBe(originalOutput);
        expect(virtualizedOutput.trim()).toBe("field:11:static:5");
    });

    test("supports inheritance and super inside virtualized functions", async () => {
        const code = `
// @virtualize
function demo() {
  class BaseBox {
    prefix = "base";
    static root = "ROOT";

    constructor(seed) {
      this.seed = seed;
    }

    render() {
      return this.prefix + ":" + this.seed;
    }

    static label() {
      return this.root;
    }
  }

  class ChildBox extends BaseBox {
    suffix = "child";
    static root = "CHILD";

    constructor(seed) {
      super(seed + 1);
    }

    render() {
      return super.render() + ":" + this.suffix;
    }

    static label() {
      return super.label() + ":" + this.root;
    }
  }

  const value = new ChildBox(9).render();
  return value + ":" + ChildBox.label();
}

console.log(demo());
`;

        const {originalOutput, virtualizedOutput} = await transpileAndRun(code, "class-inheritance");
        expect(virtualizedOutput).toBe(originalOutput);
        expect(virtualizedOutput.trim()).toBe("base:10:child:CHILD:CHILD");
    });

    test("supports private instance fields inside virtualized functions", async () => {
        const code = `
// @virtualize
function demo() {
  class FingerprintBox {
    #seed = 3;

    bump(step) {
      this.#seed += step;
      return this.#seed;
    }
  }

  const box = new FingerprintBox();
  return box.bump(4) + ":" + box.bump(5);
}

console.log(demo());
`;

        const {originalOutput, virtualizedOutput} = await transpileAndRun(code, "private-instance-fields");
        expect(virtualizedOutput).toBe(originalOutput);
        expect(virtualizedOutput.trim()).toBe("7:12");
    });

    test("supports private static fields inside virtualized functions", async () => {
        const code = `
// @virtualize
function demo() {
  class FingerprintBox {
    static #salt = 11;

    static bump(step) {
      this.#salt += step;
      return this.#salt;
    }
  }

  return FingerprintBox.bump(4) + ":" + FingerprintBox.bump(5);
}

console.log(demo());
`;

        const {originalOutput, virtualizedOutput} = await transpileAndRun(code, "private-static-fields");
        expect(virtualizedOutput).toBe(originalOutput);
        expect(virtualizedOutput.trim()).toBe("15:20");
    });

    test("supports private instance methods inside virtualized functions", async () => {
        const code = `
// @virtualize
function demo() {
  class FingerprintBox {
    #format(value) {
      return "i:" + value;
    }

    render(value) {
      return this.#format(value + 3);
    }
  }

  return new FingerprintBox().render(6);
}

console.log(demo());
`;

        const {originalOutput, virtualizedOutput} = await transpileAndRun(code, "private-instance-methods");
        expect(virtualizedOutput).toBe(originalOutput);
        expect(virtualizedOutput.trim()).toBe("i:9");
    });

    test("supports private static methods inside virtualized functions", async () => {
        const code = `
// @virtualize
function demo() {
  class FingerprintBox {
    static #format(value) {
      return "s:" + value;
    }

    static render(value) {
      return this.#format(value + 3);
    }
  }

  return FingerprintBox.render(6);
}

console.log(demo());
`;

        const {originalOutput, virtualizedOutput} = await transpileAndRun(code, "private-static-methods");
        expect(virtualizedOutput).toBe(originalOutput);
        expect(virtualizedOutput.trim()).toBe("s:9");
    });

    test("supports private accessors inside virtualized functions", async () => {
        const code = `
// @virtualize
function demo() {
  class FingerprintBox {
    #seed = 1;

    get #value() {
      return this.#seed + 4;
    }

    set #value(next) {
      this.#seed = next * 2;
    }

    run() {
      this.#value = 6;
      return this.#value;
    }
  }

  return new FingerprintBox().run();
}

console.log(demo());
`;

        const {originalOutput, virtualizedOutput} = await transpileAndRun(code, "private-accessors");
        expect(virtualizedOutput).toBe(originalOutput);
        expect(virtualizedOutput.trim()).toBe("16");
    });

    test("supports class static blocks inside virtualized functions", async () => {
        const code = `
// @virtualize
function demo() {
  class FingerprintBox {
    static prefix = "fp";

    static {
      this.value = this.prefix + ":7";
    }
  }

  return FingerprintBox.value;
}

console.log(demo());
`;

        const {originalOutput, virtualizedOutput} = await transpileAndRun(code, "class-static-block");
        expect(virtualizedOutput).toBe(originalOutput);
        expect(virtualizedOutput.trim()).toBe("fp:7");
    });

    test("supports static blocks with private static members inside virtualized functions", async () => {
        const code = `
// @virtualize
function demo() {
  class FingerprintBox {
    static #seed = 5;
    static total;

    static {
      this.#seed += 9;
      this.total = this.#seed;
    }
  }

  return FingerprintBox.total;
}

console.log(demo());
`;

        const {originalOutput, virtualizedOutput} = await transpileAndRun(code, "class-static-block-private");
        expect(virtualizedOutput).toBe(originalOutput);
        expect(virtualizedOutput.trim()).toBe("14");
    });

    test("supports private brand checks inside virtualized functions", async () => {
        const code = `
// @virtualize
function demo() {
  class FingerprintBox {
    #brand;
    static check(obj) {
      return #brand in obj;
    }
  }

  const box = new FingerprintBox();
  return [FingerprintBox.check(box), FingerprintBox.check({})].join(":");
}

console.log(demo());
`;

        const {originalOutput, virtualizedOutput} = await transpileAndRun(code, "private-brand-check");
        expect(virtualizedOutput).toBe(originalOutput);
        expect(virtualizedOutput.trim()).toBe("true:false");
    });

    test("supports computed class keys inside virtualized functions", async () => {
        const code = `
// @virtualize
function demo() {
  const fieldKey = "value";
  const methodKey = "render";
  const accessorKey = "label";

  class FingerprintBox {
    [fieldKey] = 9;

    [methodKey]() {
      return this[fieldKey];
    }

    get [accessorKey]() {
      return "k:" + this[methodKey]();
    }
  }

  return new FingerprintBox()[accessorKey];
}

console.log(demo());
`;

        const {originalOutput, virtualizedOutput} = await transpileAndRun(code, "class-computed-keys");
        expect(virtualizedOutput).toBe(originalOutput);
        expect(virtualizedOutput.trim()).toBe("k:9");
    });

    test("supports computed super property access inside virtualized functions", async () => {
        const code = `
// @virtualize
function demo() {
  class Base {
    greet() {
      return "base";
    }
  }

  class Derived extends Base {
    greet(key) {
      return super[key]();
    }
  }

  return new Derived().greet("greet");
}

console.log(demo());
`;

        const {originalOutput, virtualizedOutput} = await transpileAndRun(code, "class-computed-super");
        expect(virtualizedOutput).toBe(originalOutput);
        expect(virtualizedOutput.trim()).toBe("base");
    });

    test("supports super inside instance and static field initializers", async () => {
        const code = `
// @virtualize
function demo() {
  class Base {
    greet() {
      return "base";
    }
  }

  class Derived extends Base {
    greetField = super.greet() + ":field";
    static greetStaticField = "static:" + new this().greetField;
  }

  return Derived.greetStaticField;
}

console.log(demo());
`;

        const {originalOutput, virtualizedOutput} = await transpileAndRun(code, "class-super-initializers");
        expect(virtualizedOutput).toBe(originalOutput);
        expect(virtualizedOutput.trim()).toBe("static:base:field");
    });

    test("supports async class methods across public, private, static, and inherited cases", async () => {
        const code = `
// @virtualize
async function demo() {
  class Base {
    async greetBase() {
      return "base";
    }
  }

  class Derived extends Base {
    async greetPublic() {
      return (await this.greetBase()) + ":public";
    }

    async #greetPrivate() {
      return (await this.greetPublic()) + ":private";
    }

    async testPrivate() {
      return await this.#greetPrivate();
    }

    static async greetStatic() {
      return "static";
    }
  }

  const d = new Derived();
  const resPublic = await d.greetPublic();
  const resPrivate = await d.testPrivate();
  const resStatic = await Derived.greetStatic();
  return [resPublic, resPrivate, resStatic].join("|");
}

demo().then(res => console.log(res));
`;

        const {originalOutput, virtualizedOutput} = await transpileAndRun(code, "class-async-methods");
        expect(virtualizedOutput).toBe(originalOutput);
        expect(virtualizedOutput.trim()).toBe("base:public|base:public:private|static");
    });

    test("supports method decorators inside virtualized functions", async () => {
        const code = `
function decorateMethod(target, key, descriptor) {
  const original = descriptor.value;
  descriptor.value = function(...args) {
    return original.call(this, ...args) + ":decorated";
  };
  return descriptor;
}

// @virtualize
function demo() {
  class FingerprintBox {
    @decorateMethod
    render() {
      return "method";
    }
  }

  return new FingerprintBox().render();
}

console.log(demo());
`;

        const {originalOutput, virtualizedOutput} = await transpileAndRun(code, "class-method-decorator");
        expect(virtualizedOutput).toBe(originalOutput);
        expect(virtualizedOutput.trim()).toBe("method:decorated");
    });

    test("supports class decorators inside virtualized functions", async () => {
        const code = `
function decorateClass(value) {
  return class extends value {
    label() {
      return super.label() + ":decorated";
    }
  };
}

// @virtualize
function demo() {
  @decorateClass
  class FingerprintBox {
    label() {
      return "class";
    }
  }

  return new FingerprintBox().label();
}

console.log(demo());
`;

        const {originalOutput, virtualizedOutput} = await transpileAndRun(code, "class-decorator");
        expect(virtualizedOutput).toBe(originalOutput);
        expect(virtualizedOutput.trim()).toBe("class:decorated");
    });

    test("supports standard method decorators inside virtualized functions", async () => {
        const code = `
function decorateMethod(value, context) {
  return function(...args) {
    return value.call(this, ...args) + ":std";
  };
}

// @virtualize
function demo() {
  class FingerprintBox {
    @decorateMethod
    render() {
      return "method";
    }
  }

  return new FingerprintBox().render();
}

console.log(demo());
`;

        const {originalOutput, virtualizedOutput} = await transpileAndRun(code, "class-method-decorator-standard", {
            decoratorsMode: "standard"
        });
        expect(virtualizedOutput).toBe(originalOutput);
        expect(virtualizedOutput.trim()).toBe("method:std");
    });

    test("supports standard class decorators inside virtualized functions", async () => {
        const code = `
function decorateClass(value, context) {
  return class extends value {
    label() {
      return super.label() + ":std";
    }
  };
}

// @virtualize
function demo() {
  @decorateClass
  class FingerprintBox {
    label() {
      return "class";
    }
  }

  return new FingerprintBox().label();
}

console.log(demo());
`;

        const {originalOutput, virtualizedOutput} = await transpileAndRun(code, "class-decorator-standard", {
            decoratorsMode: "standard"
        });
        expect(virtualizedOutput).toBe(originalOutput);
        expect(virtualizedOutput.trim()).toBe("class:std");
    });

    test("supports async concurrency across the whole virtualized program", async () => {
        const code = `
async function delay(ms, val) {
  return new Promise(resolve => setTimeout(() => resolve(val), ms));
}

// @virtualize
async function demo() {
  const p1 = delay(10, "a");
  const p2 = delay(20, "b");
  const p3 = delay(5, "c");
  
  const results = await Promise.all([p1, p2, p3]);
  return results.join(":");
}

demo().then(res => console.log(res));
`;

        const {originalOutput, virtualizedOutput} = await transpileAndRun(code, "async-concurrency");
        expect(virtualizedOutput).toBe(originalOutput);
        expect(virtualizedOutput.trim()).toBe("a:b:c");
    });

    test("supports direct generator functions", async () => {
        const code = `
// @virtualize
function* demo() {
  yield 1;
  yield 2;
  return 3;
}

const iter = demo();
const first = iter.next();
const second = iter.next();
const third = iter.next();
console.log([first.value, second.value, third.value, third.done].join(":"));
`;

        const {originalOutput, virtualizedOutput} = await transpileAndRun(code, "generator-function");
        expect(virtualizedOutput).toBe(originalOutput);
        expect(virtualizedOutput.trim()).toBe("1:2:3:true");
    });

    test("supports direct async generator functions", async () => {
        const code = `
async function collect(iterable) {
  const values = [];
  for await (const value of iterable) {
    values.push(value);
  }
  return values.join(":");
}

// @virtualize
async function* demo() {
  yield await Promise.resolve(1);
  yield await Promise.resolve(2);
}

(async () => {
  console.log(await collect(demo()));
})();
`;

        const {originalOutput, virtualizedOutput} = await transpileAndRun(code, "async-generator-function");
        expect(virtualizedOutput).toBe(originalOutput);
        expect(virtualizedOutput.trim()).toBe("1:2");
    });

    test("supports generator class methods inside virtualized functions", async () => {
        const code = `
// @virtualize
function demo() {
  class FingerprintBox {
    *generatorMethod() {
      yield 10;
      yield 20;
      return 30;
    }
  }

  const iter = new FingerprintBox().generatorMethod();
  const first = iter.next();
  const second = iter.next();
  const third = iter.next();
  return [first.value, second.value, third.value, third.done].join(":");
}

console.log(demo());
`;

        const {originalOutput, virtualizedOutput} = await transpileAndRun(code, "class-generator-methods");
        expect(virtualizedOutput).toBe(originalOutput);
        expect(virtualizedOutput.trim()).toBe("10:20:30:true");
    });

    test("supports async generator class methods inside virtualized functions", async () => {
        const code = `
async function collect(iterable) {
  const values = [];
  for await (const value of iterable) {
    values.push(value);
  }
  return values.join(":");
}

// @virtualize
async function demo() {
  class FingerprintBox {
    async *asyncGeneratorMethod() {
      yield await Promise.resolve(40);
      yield await Promise.resolve(50);
    }
  }

  return await collect(new FingerprintBox().asyncGeneratorMethod());
}

demo().then(res => console.log(res));
`;

        const {originalOutput, virtualizedOutput} = await transpileAndRun(code, "class-async-generator-methods");
        expect(virtualizedOutput).toBe(originalOutput);
        expect(virtualizedOutput.trim()).toBe("40:50");
    });
});
