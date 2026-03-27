// Temporary benchmark script — delete after use
const {transpile} = require("./src/transpile");
const fs = require("fs");
const path = require("path");
const os = require("os");

const CALLS = 10;
const REPEATS = 3;
const N = 50000;

const src = `
// @virtualize
function compute(n) {
    let s = 0;
    for (let i = 0; i < n; i++) s += i * i;
    return s;
}
`;

function bench(label, fn) {
    const times = [];
    for (let r = 0; r < REPEATS; r++) {
        const t0 = performance.now();
        for (let c = 0; c < CALLS; c++) fn();
        times.push(performance.now() - t0);
    }
    const avg = times.reduce((a, b) => a + b, 0) / REPEATS;
    const perCall = avg / CALLS;
    console.log(`${label}:`);
    console.log(`  avg/run  = ${avg.toFixed(3)} ms (${(avg / 1000).toFixed(3)} s)`);
    console.log(`  avg/call = ${perCall.toFixed(3)} ms (${(perCall / 1000).toFixed(4)} s)`);
    return avg;
}

async function buildFn(opts) {
    const result = await transpile(src, {
        fileName: "bench.js",
        writeOutput: false,
        passes: [],
        ...opts,
    });
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvmbench-"));
    const vmPath = path.join(tmpDir, "vm.js");
    const codePath = path.join(tmpDir, "code.js");
    fs.writeFileSync(vmPath, result.vm);
    // transpiled code requires the vm by its output path — rewrite the require
    const patched = result.transpiled.replace(/require\(['"][^'"]+['"]\)/, `require(${JSON.stringify(vmPath)})`);
    fs.writeFileSync(codePath, patched + "\nmodule.exports = compute;");
    return require(codePath);
}

function originalCompute(n) {
    let s = 0;
    for (let i = 0; i < n; i++) s += i * i;
    return s;
}

async function main() {
    const origAvg = bench("original JS", () => originalCompute(N));

    const lightFn = await buildFn({memoryProtection: false, deadCodeInjection: false, randomizeVMProfiles: false});
    const lightAvg = bench("light VM", () => lightFn(N));

    const hardenedFn = await buildFn({memoryProtection: true, deadCodeInjection: true, randomizeVMProfiles: true});
    const hardenedAvg = bench("hardened VM (default)", () => hardenedFn(N));

    const noMemFn = await buildFn({memoryProtection: false, deadCodeInjection: false, randomizeVMProfiles: true});
    const noMemAvg = bench("hardened VM, memoryProtection:false", () => noMemFn(N));

    console.log("\n--- slowdown vs original ---");
    console.log(`light VM:                       ${(lightAvg / origAvg).toFixed(1)}x`);
    console.log(`hardened VM (default):          ${(hardenedAvg / origAvg).toFixed(1)}x`);
    console.log(`hardened VM, no memProtection:  ${(noMemAvg / origAvg).toFixed(1)}x`);
    console.log(`hardened vs light:              ${(hardenedAvg / lightAvg).toFixed(2)}x`);
}

main().catch(console.error);
