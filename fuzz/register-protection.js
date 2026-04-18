/**
 * Jazzer.js fuzz target for register protection token system.
 *
 * Validates that create/restore cycle works correctly for all 32-bit
 * nextToken boundary values. Catches the overflow bug where nextToken++
 * produces a value > 2^32 that doesn't round-trip through >>> 0 masking.
 *
 * Run: npx jazzer fuzz/register-protection.js --sync -- -max_total_time=30
 */

function rotateLeft(value, shift) {
    return ((value << shift) | (value >>> (32 - shift))) >>> 0;
}

function createRegisterProtectionMask(seed, register) {
    return rotateLeft((seed ^ Math.imul(register + 1, 0x9e3779b1)) >>> 0, register % 29 + 3);
}

function createMemoryProtectionState(key) {
    let seed = 0x9e3779b9;
    for (let i = 0; i < key.length; i++) {
        seed = Math.imul((seed ^ key.charCodeAt(i)) >>> 0, 0x45d9f3b) >>> 0;
    }
    return { enabled: true, seed, heap: new Map(), nextToken: 1, laneEpoch: 0 };
}

function createProtectedRegisterValue(state, register, value) {
    state.laneEpoch = (state.laneEpoch + 1) >>> 0;
    const token = state.nextToken = (state.nextToken + 1) >>> 0;
    state.heap.set(token, value);
    const laneSeed = (state.seed ^ Math.imul(state.laneEpoch, 0x9e3779b1)) >>> 0;
    const maskedToken = (token ^ createRegisterProtectionMask(laneSeed, register)) >>> 0;
    const guard = rotateLeft((maskedToken ^ laneSeed ^ register) >>> 0, 11);
    return { __jsvmProtected: true, token: maskedToken, guard, laneEpoch: state.laneEpoch };
}

function restoreProtectedRegisterValue(state, register, value, consume) {
    if (!value || value.__jsvmProtected !== true) return value;
    const laneEpoch = value.laneEpoch >>> 0;
    const laneSeed = (state.seed ^ Math.imul(laneEpoch, 0x9e3779b1)) >>> 0;
    const expectedGuard = rotateLeft((value.token ^ laneSeed ^ register) >>> 0, 11);
    if (value.guard !== expectedGuard) throw new Error("guard check failed");
    const token = (value.token ^ createRegisterProtectionMask(laneSeed, register)) >>> 0;
    if (!state.heap.has(token)) throw new Error("token missing reg=" + register + " token=" + token);
    const resolved = state.heap.get(token);
    if (consume) state.heap.delete(token);
    return resolved;
}

module.exports.fuzz = function(data) {
    if (data.length < 5) return;

    const state = createMemoryProtectionState("fuzz-key");
    state.nextToken = data.readUInt32LE(0);
    const register = data[4] % 250;

    // Simulate multiple create/restore cycles (like rotateProtectedRegisters)
    for (let i = 0; i < 5; i++) {
        const pv = createProtectedRegisterValue(state, register, 1000 + i);
        const restored = restoreProtectedRegisterValue(state, register, pv, true);
        if (restored !== 1000 + i) {
            throw new Error("value mismatch: expected " + (1000 + i) + " got " + restored);
        }
    }
};
