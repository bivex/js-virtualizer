
const { transpile } = require("./src/transpile");
const childProcess = require("child_process");
(async () => {
    const code = `// @virtualize
function add(a,b){return a+b}
// @virtualize
function sub(a,b){return a-b}
console.log(add(10,5), sub(10,5))`;
    const result = await transpile(code, { nestedVM: false, codeInterleaving: true });
    // Run the transpiled code
    console.log("Transpiled:", childProcess.execFileSync("node", [result.transpiledOutputPath]).toString());
})();
