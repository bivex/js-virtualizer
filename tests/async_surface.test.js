const {transpileAndRun} = require("./helpers/runtime");

describe("async surface", () => {
    test("supports awaited try/catch/finally paths", async () => {
        const source = `
async function waitResolve(value, ms) {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

async function waitReject(message, ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms));
}

// @virtualize
async function demo() {
  const trace = [];

  try {
    trace.push(await waitResolve("try", 15));
    await waitReject("boom", 15);
  } catch (error) {
    trace.push(error.message);
  } finally {
    trace.push(await waitResolve("finally", 15));
  }

  return JSON.stringify(trace);
}

demo().then((result) => console.log(result));
`;

        const {originalOutput, virtualizedOutput} = await transpileAndRun(source, "async-try-finally");

        expect(virtualizedOutput).toBe(originalOutput);
        expect(JSON.parse(virtualizedOutput.trim())).toEqual(["try", "boom", "finally"]);
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
async function delay(value, ms) {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

// @virtualize
async function demo() {
  async function build(label, ms) {
    const pending = delay(label, ms);
    return await pending;
  }

  const parts = await Promise.all([
    build("L", 25),
    build("R", 25)
  ]);

  return parts.join("");
}

demo().then((result) => console.log(result));
`;

        const {originalOutput, virtualizedOutput} = await transpileAndRun(source, "async-promise-all");

        expect(virtualizedOutput).toBe(originalOutput);
        expect(virtualizedOutput.trim()).toBe("LR");
    });
});
