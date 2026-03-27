/**
 * Copyright (c) 2026 Bivex
 *
 * Author: Bivex
 * Available for contact via email: support@b-b.top
 * For up-to-date contact information:
 * https://github.com/bivex
 *
 * Created: 2026-03-27 02:03
 * Last Updated: 2026-03-27 02:03
 *
 * Licensed under the MIT License.
 * Commercial licensing available upon request.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");

const JSVM = require("../src/vm_dev");
const {transpile} = require("../src/transpile");

function extractEmbeddedVmProfile(source) {
    const match = source.match(/new __JSV_RUNTIME\((\{[\s\S]*?\})\)/);
    if (!match) {
        throw new Error("Failed to extract embedded VM profile");
    }
    return Function(`return (${match[1]});`)();
}

function runNodeScript(filePath) {
    return childProcess.execFileSync("node", [filePath]).toString();
}

describe("randomized register vm profiles", () => {
    test("JSVM constructor honors explicit profile register sizing and dispatcher settings", () => {
        const vm = new JSVM({
            profileId: "probe-profile",
            registerCount: 144,
            dispatcherVariant: "striped",
            aliasBaseCount: 1,
            aliasJitter: 1,
            decoyCount: 9,
            decoyStride: 2,
            runtimeOpcodeDerivation: "position"
        }).setBytecodeIntegrityKey("probe-profile");

        expect(vm.registers).toHaveLength(144);
        expect(vm.getProfile()).toMatchObject({
            profileId: "probe-profile",
            registerCount: 144,
            dispatcherVariant: "striped",
            runtimeOpcodeDerivation: "position"
        });
        expect(vm.dispatchSlotKinds).toContain("decoy");
    });

    test("transpile embeds randomized VM profiles by default", async () => {
        const result = await transpile(`
// @virtualize
function demo(value) {
  return value + 1;
}

console.log(demo(2));
`, {
            fileName: "vm-profile-random.js",
            writeOutput: false,
            passes: ["RemoveUnused"]
        });

        const profile = extractEmbeddedVmProfile(result.transpiled);

        expect(profile.profileId).toMatch(/^vm_/);
        expect(profile.registerCount).toBeGreaterThanOrEqual(192);
        expect(profile.registerCount).toBeLessThanOrEqual(256);
        expect(["clustered", "striped"]).toContain(profile.dispatcherVariant);
        expect(profile.aliasBaseCount).toBeGreaterThanOrEqual(3);
        expect(profile.aliasJitter).toBeGreaterThanOrEqual(2);
        expect(profile.decoyCount).toBeGreaterThanOrEqual(24);
        expect(profile.decoyStride).toBeLessThanOrEqual(2);
        expect(["hybrid", "stateful"]).toContain(profile.runtimeOpcodeDerivation);
    });

    test("transpile honors explicit vmProfile and preserves runtime behavior", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsvm-vm-profile-"));
        const sourcePath = path.join(tempDir, "profile.source.js");
        const vmOutputPath = path.join(tempDir, "profile.vm.js");
        const transpiledOutputPath = path.join(tempDir, "profile.virtualized.js");
        const source = `
function invoke(callback, value) {
  return callback(value);
}

// @virtualize
function demo(input) {
  const suffix = "!";
  const handler = function(value) {
    return value.toUpperCase() + suffix;
  };
  return invoke(handler, input);
}

console.log(demo("profile"));
`;
        const explicitProfile = {
            profileId: "custom-profile",
            registerCount: 160,
            dispatcherVariant: "clustered",
            aliasBaseCount: 2,
            aliasJitter: 0,
            decoyCount: 10,
            decoyStride: 2,
            runtimeOpcodeDerivation: "stateful"
        };

        fs.writeFileSync(sourcePath, source);

        const result = await transpile(source, {
            fileName: "vm-profile-explicit.js",
            vmOutputPath,
            transpiledOutputPath,
            passes: ["RemoveUnused"],
            vmProfile: explicitProfile
        });

        const profile = extractEmbeddedVmProfile(result.transpiled);
        const originalOutput = runNodeScript(sourcePath).trim();
        const virtualizedOutput = runNodeScript(transpiledOutputPath).trim();

        expect(profile).toMatchObject(explicitProfile);
        expect(virtualizedOutput).toBe(originalOutput);
        expect(virtualizedOutput).toBe("PROFILE!");
    });

    test("different transpile runs synthesize different randomized profile ids", async () => {
        const source = `
// @virtualize
function demo(value) {
  return value * 2;
}

console.log(demo(3));
`;

        const first = await transpile(source, {
            fileName: "vm-profile-first.js",
            writeOutput: false,
            passes: ["RemoveUnused"]
        });
        const second = await transpile(source, {
            fileName: "vm-profile-second.js",
            writeOutput: false,
            passes: ["RemoveUnused"]
        });

        const firstProfile = extractEmbeddedVmProfile(first.transpiled);
        const secondProfile = extractEmbeddedVmProfile(second.transpiled);

        expect(firstProfile.profileId).not.toBe(secondProfile.profileId);
    });
});
