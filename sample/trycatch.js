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
function evaluate() {
    try {
        throw new Error("This is an error")
    } catch (e) {
        console.log("Caught an exception:", e)
    } finally {
        console.log("Finally block executed")
    }
}

evaluate()
