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
    let x = 1;

    x = (x++, x);

    console.log(x);

    x = (2, 3);

    console.log(x);

    let from = 0;
    let to = 10;
    let i = from

    let skipIf = function (value) {
        return i === value ? (i = to, true) : false;
    }
    for(; skipIf(3), i < to; i++) {
        console.log(i);
    }
}

evaluate()
