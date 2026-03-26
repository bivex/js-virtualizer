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

const object = {
    a: 1,
    b: 2,
    c: 3
};

// @virtualize
function evaluate() {
    return object["a"] + object.b + object[""+"c"];
}

console.log(evaluate());
