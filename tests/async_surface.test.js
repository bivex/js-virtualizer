const {transpileAndRun} = require("./helpers/runtime");

describe("async surface", () => {
    test("supports awaited try/catch/finally paths", async () => {
        const source = `
async function delay(ms, val) {
  return new Promise(resolve => setTimeout(() => resolve(val), ms));
}

// @virtualize
async function demo() {
  let log = [];
  try {
    log.push("try-start");
    const val = await delay(10, "try-await");
    log.push(val);
  } catch (e) {
    log.push("catch:" + e.message);
  } finally {
    log.push("finally");
  }
  return log.join(":");
}

demo().then((result) => console.log(result));
`;

        const {originalOutput, virtualizedOutput} = await transpileAndRun(source, "async-try-catch-finally");
        expect(virtualizedOutput).toBe(originalOutput);
        expect(virtualizedOutput.trim()).toBe("try-start:try-await:finally");
    });

    test("supports async callbacks that capture outer this", async () => {
        const source = `
async function invoke(callback) {
  return await callback(5);
}

const probe = {
  prefix: "fp:",
  // @virtualize
  async run() {
    const handler = async (value) => {
      const resolved = await Promise.resolve(value + 2);
      return this.prefix + resolved;
    };

    return await invoke(handler);
  }
};

probe.run().then((result) => console.log(result));
`;

        const {originalOutput, virtualizedOutput} = await transpileAndRun(source, "async-callback-this");

        expect(virtualizedOutput).toBe(originalOutput);
        expect(virtualizedOutput.trim()).toBe("fp:7");
    });

    test("supports nested async helpers alongside Promise.all", async () => {
        const source = `
async function delay(ms, val) {
  return new Promise(resolve => setTimeout(() => resolve(val), ms));
}

// @virtualize
async function demo() {
  async function helper1() {
    return await delay(10, "x");
  }
  
  async function helper2() {
    return await delay(5, "y");
  }

  const results = await Promise.all([helper1(), helper2()]);
  return results.join(":");
}

demo().then((result) => console.log(result));
`;

        const {originalOutput, virtualizedOutput} = await transpileAndRun(source, "async-nested-promise-all");
        expect(virtualizedOutput).toBe(originalOutput);
        expect(virtualizedOutput.trim()).toBe("x:y");
    });
});
