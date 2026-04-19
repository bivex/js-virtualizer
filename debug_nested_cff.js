const {transpile} = require('./src/transpile');
const code = `
// @virtualize
function evaluate() {
    const value = 0.5;
    if (value > 0.7) {
        return 1;
    } else {
        return 3;
    }
}
console.log(evaluate());
`;
transpile(code, {
    fileName: 'debug_nested_cff',
    passes: ['RemoveUnused'],
    nestedVM: true,
    writeOutput: true
}).then(r => {
    console.log('Done');
}).catch(e => console.error(e));
