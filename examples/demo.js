const { transpile } = require("../src/transpile");
const fs = require("fs");
const path = require("path");
const os = require("os");

const source = `
// @virtualize
function hello(name) {
    return "Hello, " + name + "!";
}

console.log(hello("World"));
`;

async function run() {
    const outDir = path.join(__dirname, "../output/demo");
    fs.mkdirSync(outDir, { recursive: true });

    const vmOutputPath = path.join(outDir, "vm.js");
    const transpiledOutputPath = path.join(outDir, "app.js");

    const result = await transpile(source, {
        fileName: "demo",
        vmOutputPath,
        transpiledOutputPath,
        passes: ["RemoveUnused"],
        opaquePredicates: true,
        controlFlowFlattening: true,
        selfModifyingBytecode: true,
    });

    console.log("Original:");
    console.log(source.trim());
    console.log();

    const vmCode = fs.readFileSync(vmOutputPath, "utf-8");
    const appCode = fs.readFileSync(transpiledOutputPath, "utf-8");

    console.log("VM size:", (vmCode.length / 1024).toFixed(1), "KB");
    console.log("App size:", (appCode.length / 1024).toFixed(1), "KB");
    console.log("Opcodes used:", [...new Set(appCode.match(/opcodes\[\d+\]/g) || [])].length);
    console.log();

    console.log("Running virtualized...");
    const { execFileSync } = require("child_process");
    const out = execFileSync("node", [transpiledOutputPath], { encoding: "utf-8", timeout: 5000 });
    console.log("Output:", out.trim());
}

run().catch(console.error);
