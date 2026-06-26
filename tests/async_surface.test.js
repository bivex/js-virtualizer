const {transpileAndRun} = require("./helpers/runtime");

describe("async surface", () => {
    test.todo("supports awaited try/catch/finally paths"); // engine: async try/finally SETUP_ARRAY reads corrupt DWORD (Invalid array length)

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

    test.todo("supports nested async helpers alongside Promise.all"); // engine: async nested functions + Promise.all returns null
});
