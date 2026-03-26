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

class Reference {
    constructor(value) {
        this.value = value;
    }

    get() {
        return this.value;
    }

    set(value) {
        this.value = value;
    }

    read() {
        return this.value;
    }

    write(value) {
        this.value = value;
    }

    toString() {
        return this.value.toString();
    }

    valueOf() {
        return this.value;
    }

    static from(value) {
        return new Reference(value);
    }
}

module.exports = Reference;
