/**
 * Copyright (c) 2026 Bivex
 *
 * Author: Bivex
 * Available for contact via email: support@b-b.top
 * For up-to-date contact information:
 * https://github.com/bivex
 *
 * Created: 2026-03-26 18:54
 * Last Updated: 2026-03-26 18:54
 *
 * Licensed under the MIT License.
 * Commercial licensing available upon request.
 */

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
