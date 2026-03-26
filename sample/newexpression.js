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

class Example {
    constructor(a, b) {
        this.a = a;
        this.b = b;
        this.secret = 0.5;
        console.log('Secret');
        console.log(this.secret);
    }

    call() {
        console.log('External Call');
        return this.a + this.b + this.secret;
    }
}

// @virtualize
function evaluate() {
    const a = new Example(1, 2);
    return a.call();
}

console.log(evaluate());
