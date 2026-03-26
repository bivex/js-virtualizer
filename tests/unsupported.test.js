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

function toRunnableSource(code) {
    try {
        new Function(code);
        return code;
    } catch (error) {
        if (!String(error.message).includes("Invalid or unexpected token")) {
            throw error;
        }
    }

    const transformed = babel.transformSync(code, {
        configFile: false,
        babelrc: false,
        comments: true,
        retainLines: true,
        sourceType: "module",
        plugins: [[decoratorsPlugin, {legacy: true}]]
    });

    if (!transformed || !transformed.code) {
        throw new Error("Failed to build runnable decorator source");
    }

    return transformed.code;
}

async function transpileAndRun(code, label) {
    const slug = `${label}-${crypto.randomBytes(4).toString("hex")}`;
    const inputPath = path.join(__dirname, `../output/${slug}.source.js`);
    const vmOutputPath = path.join(__dirname, `../output/${slug}.vm.js`);
    const transpiledOutputPath = path.join(__dirname, `../output/${slug}.virtualized.js`);

    fs.writeFileSync(inputPath, toRunnableSource(code));

    const result = await transpile(code, {
        fileName: `${slug}.js`,
        vmOutputPath,
        transpiledOutputPath,
        passes: ["RemoveUnused"]
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
      return "m:" + value;
    }

    render(value) {
      return this.#format(value + 2);
    }
  }

  return new FingerprintBox().render(5);
}

console.log(demo());
`;

        const {originalOutput, virtualizedOutput} = await transpileAndRun(code, "private-instance-methods");
        expect(virtualizedOutput).toBe(originalOutput);
        expect(virtualizedOutput.trim()).toBe("m:7");
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
    #seed = 3;

    hasBrand(target) {
      return #seed in target;
    }
  }

  const box = new FingerprintBox();
  return String(box.hasBrand(box)) + ":" + String(box.hasBrand({}));
}

console.log(demo());
`;

        const {originalOutput, virtualizedOutput} = await transpileAndRun(code, "class-private-brand-check");
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
  const methodKey = "render";

  class BaseBox {
    [methodKey]() {
      return "base";
    }
  }

  class ChildBox extends BaseBox {
    [methodKey]() {
      return super[methodKey]() + ":child";
    }
  }

  return new ChildBox()[methodKey]();
}

console.log(demo());
`;

        const {originalOutput, virtualizedOutput} = await transpileAndRun(code, "class-computed-super");
        expect(virtualizedOutput).toBe(originalOutput);
        expect(virtualizedOutput.trim()).toBe("base:child");
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

    test("supports async concurrency across the whole virtualized program", async () => {
        const slug = `async-concurrency-${crypto.randomBytes(4).toString("hex")}`;
        const code = `
async function delay(value, ms) {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

// @virtualize
async function demo() {
  const started = Date.now();

  async function helper(value, ms) {
    const pending = delay(value, ms);
    return await pending;
  }

  const first = delay("A", 80);
  const second = helper("B", 80);
  const combined = await Promise.all([first, second]);

  return JSON.stringify({
    value: combined.join(""),
    elapsed: Date.now() - started
  });
}

demo().then((result) => console.log(result));
`;

        const inputPath = path.join(__dirname, `../output/${slug}.source.js`);
        const vmOutputPath = path.join(__dirname, `../output/${slug}.vm.js`);
        const transpiledOutputPath = path.join(__dirname, `../output/${slug}.virtualized.js`);

        fs.writeFileSync(inputPath, code);

        const result = await transpile(code, {
            fileName: `${slug}.js`,
            vmOutputPath,
            transpiledOutputPath,
            passes: ["RemoveUnused"]
        });

        const originalData = JSON.parse(childProcess.execSync(`node ${inputPath}`).toString());
        const virtualizedData = JSON.parse(childProcess.execSync(`node ${result.transpiledOutputPath}`).toString());

        expect(virtualizedData.value).toBe(originalData.value);
        expect(virtualizedData.value).toBe("AB");
        expect(originalData.elapsed).toBeLessThan(170);
        expect(virtualizedData.elapsed).toBeLessThan(170);
    });
});
