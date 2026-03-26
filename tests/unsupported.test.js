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

const {transpile} = require("../src/transpile");

async function transpileAndRun(code, label) {
    const slug = `${label}-${crypto.randomBytes(4).toString("hex")}`;
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

    test.todo("supports async concurrency across the whole virtualized program");
});
