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

const path = require("node:path");
const fs = require("node:fs");

const {transpile} = require("../src/transpile");
const sampleCode = fs.readFileSync(path.join(__dirname, "expressAsync.js"), "utf-8");

async function main() {
    const result = await transpile(sampleCode, {
        fileName: "expressAsync.js",
    });

    console.log(`Virtualized code saved to: ${result.transpiledOutputPath}`);
}

main()
