const {transpileAndRun} = require("./helpers/runtime");

describe("top-level initializer virtualization", () => {
    test("virtualizes top-level variable initializers without markers", async () => {
        const source = `
const seed = 7;
const doubled = seed * 2;
const rendered = doubled + 1;

console.log(doubled);
console.log(rendered);
`;

        const {result, originalOutput, virtualizedOutput} = await transpileAndRun(source, "top-level-init");

        expect(virtualizedOutput).toBe(originalOutput);
        expect(virtualizedOutput.trim()).toBe("14\n15");
        expect(result.transpiled).toContain("__jsv_top_init_");
        expect(result.transpiled).not.toContain("__jsv_top_expr_");
    });

    test("preserves top-level this for automatic initializer virtualization", async () => {
        const source = `
this.answer = 9;
const doubled = this.answer * 2;

console.log(this.answer);
console.log(doubled);
`;

        const {originalOutput, virtualizedOutput} = await transpileAndRun(source, "top-level-this");

        expect(virtualizedOutput).toBe(originalOutput);
        expect(virtualizedOutput.trim()).toBe("9\n18");
    });
});
