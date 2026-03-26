const nodeVm = require("node:vm");
const zlib = require("node:zlib");

const {transpile} = require("../src/transpile");

describe("browser execution", () => {
    test("runs native vm_dist output in a browser-like sandbox without require", async () => {
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
            passes: ["RemoveUnused"]
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

        const appSandbox = {
            console,
            navigator: runtimeSandbox.navigator,
            screen: runtimeSandbox.screen,
            document,
            atob: runtimeSandbox.atob,
            pako: runtimeSandbox.pako,
            JSVM: runtimeSandbox.JSVM
        };
        appSandbox.globalThis = appSandbox;
        appSandbox.window = appSandbox;
        appSandbox.self = appSandbox;

        nodeVm.runInNewContext(result.transpiled, appSandbox);

        expect(document.body.textContent).toBe("browser:en-US:1440");
    });
});
