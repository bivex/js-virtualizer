// @virtualize
function buildFingerprint(label) {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown";
    const locale = Intl.DateTimeFormat().resolvedOptions().locale || "unknown";
    const parts = [
        label,
        process.platform,
        process.arch,
        process.version,
        timezone,
        locale
    ];

    let payload = "";
    for (const part of parts) {
        payload += `${part}|`;
    }

    let hash = 0;
    for (let i = 0; i < payload.length; i++) {
        hash = (hash * 131 + payload.charCodeAt(i)) % 1000000007;
    }

    return {
        label,
        fingerprint: hash.toString(16),
        payload
    };
}

console.log(JSON.stringify(buildFingerprint("demo-session"), null, 2));
