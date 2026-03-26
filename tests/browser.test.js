const nodeVm = require("node:vm");
const zlib = require("node:zlib");

const {transpile} = require("../src/transpile");

describe("browser execution", () => {
    test("runs obfuscated browser runtime output in a browser-like sandbox without require", async () => {
        const source = `
// @virtualize
function demo() {
  return "browser:" + navigator.language + ":" + screen.width;
}

document.body.textContent = demo();
`;

        const result = await transpile(source, {
            fileName: "browser-runtime.js",
            writeOutput: false,
            passes: ["RemoveUnused", "ObfuscateVM", "ObfuscateTranspiled"],
            vmObfuscationTarget: "browser",
            transpiledObfuscationTarget: "browser"
        });

        const document = {
            body: {
                textContent: ""
            }
        };

        const runtimeSandbox = {
            console,
            navigator: {
                language: "en-US"
            },
            screen: {
                width: 1440
            },
            document,
            atob(value) {
                return Buffer.from(value, "base64").toString("binary");
            },
            pako: {
                inflate(buffer) {
                    return zlib.inflateSync(Buffer.from(buffer));
                }
            }
        };

        runtimeSandbox.globalThis = runtimeSandbox;
        runtimeSandbox.window = runtimeSandbox;
        runtimeSandbox.self = runtimeSandbox;

        expect("require" in runtimeSandbox).toBe(false);

        nodeVm.runInNewContext(result.vm, runtimeSandbox);
        expect(typeof runtimeSandbox.JSVM).toBe("function");

        // Browser script tags share one global scope, so the transpiled app
        // must coexist with the already-loaded VM runtime in the same context.
        nodeVm.runInNewContext(result.transpiled, runtimeSandbox);

        expect(document.body.textContent).toBe("browser:en-US:1440");
    });
});
