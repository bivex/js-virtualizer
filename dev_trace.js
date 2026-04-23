
const { transpile } = require("./src/transpile");
const childProcess = require("child_process");
(async () => {
    const code = `// @virtualize
function add(a,b){return a+b}
// @virtualize
function sub(a,b){return a-b}
console.log("sub(10,5)=", sub(10,5));`;
    const result = await transpile(code, { fileName: "tstdbg", nestedVM: false, codeInterleaving: true });
})();
