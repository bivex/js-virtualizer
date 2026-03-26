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
function random(...args) {
    console.log(args)

    function proto(a, b = 3, ...args) {
        console.log(a, b, args)
    }

    proto(1, 2, 3, 4, 5)
    proto(1)
}

random(1, 2, 3, 4, 5)
