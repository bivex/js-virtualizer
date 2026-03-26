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

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// @virtualize
async function evaluate() {
    console.log("Waiting for 1 second...");
    await sleep(1000);
    console.log("Done!");
}

evaluate();
