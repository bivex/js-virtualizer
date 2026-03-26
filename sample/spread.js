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
    const a = {
        b: 2
    }
    const b = {
        ...a,
        ...{
            c: 3,
            a: 1,
            b: 4
        },
        ...{
            d: 5,
            b: 6
        }
    }
    console.log(b)
}

evaluate()
