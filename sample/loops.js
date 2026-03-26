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

const a = [1, 3, 5, 7, 9]

// @virtualize
function evaluate() {
    for (let i = 0; i<10;i++) {
        if (i === 3) {
            console.log("Skipping i === 3")
            continue
        }
        if (i === 5) {
            console.log("Breaking at i === 5")
            break
        }
        console.log("For let loop", i)
    }
    console.log("For let loop done")
    for (const i in a) {
        if (i === "1") {
            console.log("Skipping i === \"1\" value")
            continue
        }
        if (i === "3") {
            console.log("Breaking at i === \"3\" value")
            break
        }
        console.log("For in loop", i)
    }
    console.log("For in loop done")
    for (const i of a) {
        if (i === 3) {
            console.log("Skipping 3")
            continue
        }
        if (i === 7) {
            console.log("Breaking at 7")
            break
        }
        console.log("For of loop", i)
    }
    console.log("For of loop done")
    let i = 0
    while (true) {
        if (i === 3) {
            console.log("Skipping i === 3")
            i++
            continue
        }
        if (i === 5) {
            console.log("Breaking at i === 5")
            break
        }
        console.log("While loop", i)
        i++
    }
    console.log("While loop done\n\nAll loops done!")
}

evaluate()
