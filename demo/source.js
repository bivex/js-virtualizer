/**
 * Secure License Manager
 *
 * Демонстрация js-virtualizer: логика генерации и проверки лицензий
 * защищена через виртуализацию байткода.
 */

// @virtualize
function generateLicenseKey(userId, plan, secret) {
    const timestamp = Math.floor(Date.now() / 1000);
    const days = plan === "premium" ? 365 : plan === "pro" ? 90 : 30;
    const expiresAt = timestamp + days * 86400;

    const payload = `${userId}:${plan}:${expiresAt}:${secret}`;
    let hash = 5381;
    for (let i = 0; i < payload.length; i++) {
        hash = ((hash << 5) + hash + payload.charCodeAt(i)) & 0xFFFFFFFF;
    }

    const sig = Math.abs(hash).toString(16).padStart(8, "0");
    const b64 = Buffer.from(`${userId}|${plan}|${expiresAt}|${sig}`).toString("base64url");

    return { key: `LIC-${b64}`, plan, expiresAt, userId };
}

// @virtualize
function validateLicenseKey(key, secret) {
    if (!key.startsWith("LIC-")) {
        return { valid: false, error: "Invalid format" };
    }

    const b64 = key.slice(4);
    let decoded;
    try {
        decoded = Buffer.from(b64, "base64url").toString("utf-8");
    } catch (e) {
        return { valid: false, error: "Decode failed" };
    }

    const parts = decoded.split("|");
    if (parts.length !== 4) {
        return { valid: false, error: "Malformed license" };
    }

    const [userId, plan, expiresStr, sig] = parts;
    const expiresAt = parseInt(expiresStr, 10);
    const now = Math.floor(Date.now() / 1000);

    if (isNaN(expiresAt) || now > expiresAt) {
        return { valid: false, error: "License expired" };
    }

    const payload = `${userId}:${plan}:${expiresAt}:${secret}`;
    let hash = 5381;
    for (let i = 0; i < payload.length; i++) {
        hash = ((hash << 5) + hash + payload.charCodeAt(i)) & 0xFFFFFFFF;
    }
    const expectedSig = Math.abs(hash).toString(16).padStart(8, "0");

    if (sig !== expectedSig) {
        return { valid: false, error: "Invalid signature" };
    }

    return { valid: true, userId, plan, expiresAt };
}

// @virtualize
function getPlanFeatures(plan) {
    if (plan === "premium") {
        return { maxProjects: -1, collaborators: -1, storage: "unlimited", api: true, support: "priority" };
    }
    if (plan === "pro") {
        return { maxProjects: 20, collaborators: 5, storage: "50GB", api: true, support: "email" };
    }
    return { maxProjects: 3, collaborators: 1, storage: "1GB", api: false, support: "community" };
}

// === CLI Interface ===
const args = process.argv.slice(2);
const SECRET = "js-virtualizer-demo-secret-2026";

function printHelp() {
    console.log(`
╔══════════════════════════════════════════════╗
║       Secure License Manager (Demo)          ║
║       Protected by js-virtualizer            ║
╚══════════════════════════════════════════════╝

Usage:
  node source.js generate <userId> <plan>
  node source.js validate <licenseKey>
  node source.js features <plan>

Plans: free, pro, premium
`);
}

if (args.length === 0) {
    printHelp();
    process.exit(0);
}

const command = args[0];

if (command === "generate") {
    const userId = args[1] || "user-001";
    const plan = args[2] || "pro";
    const license = generateLicenseKey(userId, plan, SECRET);
    console.log("Generated License:");
    console.log(JSON.stringify(license, null, 2));
    const expiry = new Date(license.expiresAt * 1000).toISOString();
    console.log(`\nKey: ${license.key}`);
    console.log(`Plan: ${license.plan}`);
    console.log(`Expires: ${expiry}`);
} else if (command === "validate") {
    const key = args[1];
    if (!key) {
        console.error("Error: provide a license key");
        process.exit(1);
    }
    const result = validateLicenseKey(key, SECRET);
    console.log("Validation Result:");
    console.log(JSON.stringify(result, null, 2));
} else if (command === "features") {
    const plan = args[1] || "free";
    const features = getPlanFeatures(plan);
    console.log(`Features for "${plan}" plan:`);
    console.log(JSON.stringify(features, null, 2));
} else {
    printHelp();
}
