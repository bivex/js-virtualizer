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
    call: function(a, b) {
        console.log('External Call')
        return a + b
    },
    write: function(value) {
        console.log('External Write')
        console.log(value)
        return value + 5
    }
}

// @virtualize
function evaluate() {
    console.log('Internal Call')
    console.log("1 + 2 = " + (1 + 2));
    const result = object.call(3, 5);
    console.log("Result of external call: " + result);

    console.log('Nested external call', object.write(object.call(4, 6)));
    return result + 1
}

console.log(evaluate());
