/**
 * Demo Builder - виртуализирует source.js через js-virtualizer
 * и проверяет, что защищённая версия работает корректно.
 */

const path = require("node:path");
const fs = require("node:fs");
const childProcess = require("node:child_process");

const { transpile } = require("../src/transpile");

const DEMO_DIR = __dirname;
const SOURCE = path.join(DEMO_DIR, "source.js");
const OUTPUT_DIR = path.join(DEMO_DIR, "dist");

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function run(cmd) {
    return childProcess.execSync(cmd, { encoding: "utf-8" }).trim();
}

function box(title, lines) {
    const w = 56;
    const line = "═".repeat(w - 2);
    console.log(`\n╔${line}╗`);
    console.log(`║ ${title.padEnd(w - 4)} ║`);
    console.log(`╠${line}╣`);
    for (const c of lines) {
        console.log(`║ ${c.padEnd(w - 4)} ║`);
    }
    console.log(`╚${line}╝`);
}

function jsonFieldsMatch(a, b, fields) {
    for (const f of fields) {
        if (a[f] !== b[f]) return false;
    }
    return true;
}

async function main() {
    ensureDir(OUTPUT_DIR);

    const sourceCode = fs.readFileSync(SOURCE, "utf-8");
    const vmPath = path.join(OUTPUT_DIR, "license-manager.vm.js");
    const appPath = path.join(OUTPUT_DIR, "license-manager.js");

    console.log("╔════════════════════════════════════════════════════════╗");
    console.log("║     js-virtualizer Demo: Secure License Manager       ║");
    console.log("╚════════════════════════════════════════════════════════╝\n");

    // --- Transpile ---
    console.log("[1/5] Transpiling with js-virtualizer...");
    const startTime = Date.now();
    const result = await transpile(sourceCode, {
        fileName: "license-manager",
        vmOutputPath: vmPath,
        transpiledOutputPath: appPath,
        passes: ["RemoveUnused", "ObfuscateVM", "ObfuscateTranspiled"],
    });
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`      Done in ${elapsed}s`);

    const vmSize = (fs.statSync(vmPath).size / 1024).toFixed(1);
    const appSize = (fs.statSync(appPath).size / 1024).toFixed(1);
    box("Output Files", [
        `VM runtime:  license-manager.vm.js  (${vmSize} KB)`,
        `App:         license-manager.js      (${appSize} KB)`,
        ``,
        `Original:    source.js               (${(sourceCode.length / 1024).toFixed(1)} KB)`,
    ]);

    // --- Test: features (deterministic) ---
    console.log("\n[2/5] Testing deterministic functions (features)...\n");
    let allOk = true;

    for (const plan of ["free", "pro", "premium"]) {
        const orig = JSON.parse(run(`node ${SOURCE} features ${plan}`).split("\n").slice(1).join("\n"));
        const virt = JSON.parse(run(`node ${appPath} features ${plan}`).split("\n").slice(1).join("\n"));
        const match = JSON.stringify(orig) === JSON.stringify(virt);
        allOk = allOk && match;
        console.log(`  [${match ? "OK" : "FAIL"}] Features for "${plan}" plan`);
    }

    // --- Test: generate + validate roundtrip ---
    console.log("\n[3/5] Testing license generation + validation roundtrip...\n");

    for (const [user, plan] of [["user-001", "free"], ["user-002", "pro"], ["user-003", "premium"]]) {
        const origGen = run(`node ${SOURCE} generate ${user} ${plan}`);
        const keyLine = origGen.match(/Key: (LIC-\S+)/);
        if (!keyLine) { allOk = false; continue; }
        const key = keyLine[1];

        const origVal = JSON.parse(run(`node ${SOURCE} validate "${key}"`).replace(/^[^{]*/, ""));
        const virtVal = JSON.parse(run(`node ${appPath} validate "${key}"`).replace(/^[^{]*/, ""));
        const origOk = origVal.valid === true && origVal.userId === user && origVal.plan === plan;
        const virtOk = virtVal.valid === true && virtVal.userId === user && virtVal.plan === plan;
        allOk = allOk && origOk && virtOk;

        console.log(`  [${origOk ? "OK" : "FAIL"}] Original validates ${plan} key`);
        console.log(`  [${virtOk ? "OK" : "FAIL"}] Virtualized validates ${plan} key`);
    }

    // --- Test: cross-validation ---
    console.log("\n[4/5] Cross-validation (orig key <-> virt key)...\n");

    const origGen = run(`node ${SOURCE} generate cross-user pro`);
    const virtGen = run(`node ${appPath} generate cross-user pro`);
    const origKey = origGen.match(/Key: (LIC-\S+)/)?.[1];
    const virtKey = virtGen.match(/Key: (LIC-\S+)/)?.[1];

    if (origKey && virtKey) {
        const cross1 = JSON.parse(run(`node ${appPath} validate "${origKey}"`).replace(/^[^{]*/, ""));
        const cross2 = JSON.parse(run(`node ${SOURCE} validate "${virtKey}"`).replace(/^[^{]*/, ""));
        const ok1 = cross1.valid === true && cross1.userId === "cross-user";
        const ok2 = cross2.valid === true && cross2.userId === "cross-user";
        allOk = allOk && ok1 && ok2;
        console.log(`  [${ok1 ? "OK" : "FAIL"}] Virtualized validates original key`);
        console.log(`  [${ok2 ? "OK" : "FAIL"}] Original validates virtualized key`);
    }

    // --- Test: invalid key ---
    console.log("\n[5/5] Testing edge cases...\n");

    const badKey1 = JSON.parse(run(`node ${SOURCE} validate "INVALID"`).replace(/^[^{]*/, ""));
    const badKey1v = JSON.parse(run(`node ${appPath} validate "INVALID"`).replace(/^[^{]*/, ""));
    const badOk1 = badKey1.valid === false && badKey1v.valid === false;
    allOk = allOk && badOk1;
    console.log(`  [${badOk1 ? "OK" : "FAIL"}] Reject invalid format`);

    const badKey2 = JSON.parse(run(`node ${SOURCE} validate "LIC-dGVtcHxmYWtlfDF8YmFkc2ln"`).replace(/^[^{]*/, ""));
    const badKey2v = JSON.parse(run(`node ${appPath} validate "LIC-dGVtcHxmYWtlfDF8YmFkc2ln"`).replace(/^[^{]*/, ""));
    const badOk2 = badKey2.valid === false && badKey2v.valid === false;
    allOk = allOk && badOk2;
    console.log(`  [${badOk2 ? "OK" : "FAIL"}] Reject expired / bad signature`);

    // --- Summary ---
    if (allOk) {
        box("ALL TESTS PASSED", [
            "Virtualized functions produce identical results",
            "to the original source code. Your business logic",
            "is now protected by bytecode virtualization!",
        ]);
    } else {
        box("SOME TESTS FAILED", [
            "Output mismatch between original and virtualized.",
            "This may indicate a transpilation issue.",
        ]);
    }

    console.log(`\nTry it yourself:`);
    console.log(`  node demo/dist/license-manager.js generate my-user pro`);
    console.log(`  node demo/dist/license-manager.js features premium\n`);
}

main().catch((err) => {
    console.error("Demo failed:", err);
    process.exitCode = 1;
});
