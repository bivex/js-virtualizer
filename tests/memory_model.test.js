const {transpileAndRun} = require("./helpers/runtime");

describe("memory model", () => {
    test("keeps returned closures on shared captured state", async () => {
        const source = `
// @virtualize
function factory() {
  let count = 1;

  function inc(step) {
    count += step;
    return count;
  }

  function read() {
    return count;
  }

  return [inc, read];
}

const pair = factory();
console.log(pair[0](2) + ":" + pair[1]() + ":" + pair[0](3) + ":" + pair[1]());
`;

        const {originalOutput, virtualizedOutput} = await transpileAndRun(source, "memory-shared-closures");

        expect(virtualizedOutput).toBe(originalOutput);
        expect(virtualizedOutput.trim()).toBe("3:3:6:6");
    });

    test("threads captured references through intermediate nested closures", async () => {
        const source = `
// @virtualize
function factory(start) {
  let seed = start;

  function wrap() {
    return function(step) {
      seed += step;
      return seed;
    };
  }

  return wrap();
}

const fn = factory(4);
console.log(fn(2) + ":" + fn(3));
`;

        const {originalOutput, virtualizedOutput} = await transpileAndRun(source, "memory-nested-closures");

        expect(virtualizedOutput).toBe(originalOutput);
        expect(virtualizedOutput.trim()).toBe("6:9");
    });

    test("preserves captured state for prototype methods after the factory returns", async () => {
        const source = `
// @virtualize
function createProbe(start) {
  let seed = start;

  function Probe(label) {
    this.label = label;
  }

  Probe.prototype.read = function(step) {
    seed += step;
    return this.label + ":" + seed;
  };

  return new Probe("probe");
}

const probe = createProbe(10);
console.log(probe.read(2) + ":" + probe.read(3));
`;

        const {originalOutput, virtualizedOutput} = await transpileAndRun(source, "memory-prototype-closures");

        expect(virtualizedOutput).toBe(originalOutput);
        expect(virtualizedOutput.trim()).toBe("probe:12:probe:15");
    });
});
