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
function buildBrowserFingerprint(label) {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown";
    const language = typeof navigator !== "undefined" && navigator.language ? navigator.language : "unknown";
    const userAgent = typeof navigator !== "undefined" && navigator.userAgent ? navigator.userAgent : "unknown";
    const width = typeof screen !== "undefined" && screen.width ? screen.width : 0;
    const height = typeof screen !== "undefined" && screen.height ? screen.height : 0;

    const parts = [
        label,
        language,
        timezone,
        String(width),
        String(height),
        userAgent
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

// @virtualize
function hashString(input) {
    let h = 0;
    for (let i = 0; i < input.length; i++) {
        h = (h * 31 + input.charCodeAt(i)) % 1000000007;
    }
    return h;
}

function renderFingerprint() {
    const result = buildBrowserFingerprint("browser-demo");
    const target = document.getElementById("fingerprint-output");
    if (target) {
        target.textContent = JSON.stringify(result, null, 2);
    }
    console.log("browser fingerprint", result);
}

window.addEventListener("DOMContentLoaded", renderFingerprint);
