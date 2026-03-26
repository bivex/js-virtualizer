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
function evaluate(a, b) {
    return (a + b * ((a + b) * (a - b + (a + b * (multiplier + a + b)))));
}

console.log(evaluate(1, 2));
