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
    const value = 0.5
    console.log("Selected value:", value)
    if (value > 0.7) {
        console.log("Value is greater than 0.7")
        return 1
    } else if (value > 0.5) {
        console.log("Value is greater than 0.5")
        return 2
    } else {
        console.log("Value is less than or equal to 0.5")
        return 3
    }
}

console.log(evaluate());
