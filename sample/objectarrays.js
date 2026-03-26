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

const multiplier = 2;

// @virtualize
function evaluate() {
    const object = {
        a: {
            c: 3,
            d: 4
        },
        b: 1,
        c: "2",
        d: [1, 2, 3]
    }
    const array = [1, "2", {a: 3}, [1, 2, 3]]
    console.log(object)
    console.log(array)
    return 1
}

console.log(evaluate());
