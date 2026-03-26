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
    // const local1 = function () {
    //     return 0.5;
    // }
    let a = 0
    let b = 0

    function local2() {
        a+=1
        if (a >= 5) {
            return a
        }
        console.log(a)
    }

    for (let i = 0; i < 10; i++) {
        local2()
    }

    function recursive() {
        b+=1
        if (b >= 5) {
            return b + 50
        }
        console.log(b)
        return recursive()
    }

    let c = 0

    const recursiveAF = () => {
        c+=1
        if (c >= 5) {
            return c + 100
        }
        console.log(c * 5)
        return recursiveAF()
    }

    console.log('Recursive')
    console.log(recursive())

    console.log('Recursive AF')
    console.log(recursiveAF())

    console.log('Done')
    console.log(a)
}

evaluate();
