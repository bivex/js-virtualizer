
const { transpile } = require("./src/transpile");
const childProcess = require("child_process");
(async () => {
    const code = `// @virtualize
function add(a,b){return a+b}
// @virtualize
function sub(a,b){return a-b}
console.log("TEST_RESULT:", sub(10,5));`;
    const result = await transpile(code, { 
        fileName: "tstdbg", 
        nestedVM: false, 
        codeInterleaving: true, 
        controlFlowFlattening: true,
        opaquePredicates: true
    });
    console.log("Execution Output:");
    try {
        const out = childProcess.execFileSync("node", [result.transpiledOutputPath], { timeout: 3000 });
        console.log(out.toString());
    } catch (e) {
        console.error("Execution failed:", e.message);
        if (e.stdout) console.log("STDOUT:", e.stdout.toString());
    }
})();
