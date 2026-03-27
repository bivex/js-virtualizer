// Temporary benchmark script — delete after use
const {transpile} = require("./src/transpile");

const CALLS = 10;
const REPEATS = 3;

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
    console.log(`${label}: avg ${avg.toFixed(3)} ms/run | ${(avg / CALLS).toFixed(3)} ms/call`);
    return avg;
}

function originalCompute(n) {
    let s = 0;
    for (let i = 0; i < n; i++) s += i * i;
    return s;
}

async function main() {
    const origAvg = bench("original JS", () => originalCompute(50000));

    // light VM
    const lightResult = await transpile(src, {
        fileName: "bench_light.js",
        writeOutput: false,
        passes: [],
        memoryProtection: false,
        deadCodeInjection: false,
        randomizeVMProfiles: false,
    });
    const lightFn = new Function(`${lightResult.transpiledCode}\nreturn compute;`)();
    const lightAvg = bench("light VM", () => lightFn(50000));

    // hardened VM (default)
    const hardenedResult = await transpile(src, {
        fileName: "bench_hardened.js",
        writeOutput: false,
        passes: [],
        memoryProtection: true,
        deadCodeInjection: true,
        randomizeVMProfiles: true,
    });
    const hardenedFn = new Function(`${hardenedResult.transpiledCode}\nreturn compute;`)();
    const hardenedAvg = bench("hardened VM (default)", () => hardenedFn(50000));

    // hardened VM without memoryProtection
    const noMemResult = await transpile(src, {
        fileName: "bench_noprot.js",
        writeOutput: false,
        passes: [],
        memoryProtection: false,
        deadCodeInjection: false,
        randomizeVMProfiles: true,
    });
    const noMemFn = new Function(`${noMemResult.transpiledCode}\nreturn compute;`)();
    const noMemAvg = bench("hardened VM, memoryProtection:false", () => noMemFn(50000));

    console.log("\n--- slowdown vs original ---");
    console.log(`light VM:                       ${(lightAvg / origAvg).toFixed(1)}x`);
    console.log(`hardened VM (default):          ${(hardenedAvg / origAvg).toFixed(1)}x`);
    console.log(`hardened VM, no memProtection:  ${(noMemAvg / origAvg).toFixed(1)}x`);
    console.log(`hardened vs light:              ${(hardenedAvg / lightAvg).toFixed(2)}x`);
}

main().catch(console.error);
