/**
 * Copyright (c) 2026 Bivex
 *
 * Author: Bivex
 * Available for contact via email: support@b-b.top
 * For up-to-date contact information:
 * https://github.com/bivex
 *
 * Created: 2026-03-27 19:25
 * Last Updated: 2026-03-27 19:25
 *
 * Licensed under the MIT License.
 * Commercial licensing available upon request.
 */

const {transpileAndRun} = require("./helpers/runtime");

describe("control flow", () => {
    test("supports early returns inside conditional branches", async () => {
        const source = `
// @virtualize
function classify(value, options) {
  options = options || {};
  const type = typeof value;

  if (type === "string") {
    return "string";
  }

  if (type === "number") {
    return options.long ? "number:long" : "number";
  }

  return "other";
}

console.log(JSON.stringify(classify("abc")));
console.log(JSON.stringify(classify(42)));
console.log(JSON.stringify(classify(42, { long: true })));
console.log(JSON.stringify(classify({ ok: true })));
`;

        const {originalOutput, virtualizedOutput} = await transpileAndRun(source, "control-flow-early-return");

        expect(virtualizedOutput).toBe(originalOutput);
        expect(virtualizedOutput.trim()).toBe([
            "\"string\"",
            "\"number\"",
            "\"number:long\"",
            "\"other\""
        ].join("\n"));
    });
});
