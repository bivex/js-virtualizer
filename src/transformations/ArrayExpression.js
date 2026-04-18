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

const {Opcode, BytecodeValue} = require("../utils/assembler");
const {needsCleanup} = require("../utils/constants");

// ALWAYS produces a mutable result, ownership is transferred to the caller
function resolveArrayExpression(node) {
    const {elements} = node

    const arrayRegister = this.getAvailableTempLoad()
    this.chunk.append(new Opcode('SETUP_ARRAY', arrayRegister, this.encodeDWORD(elements.length)));
    this.buildArrayFromItems(elements, (element, counter, idx) => {
        const elementRegister = this.resolveExpression(element).outputRegister
        this.chunk.append(new Opcode('SET_INDEX', arrayRegister, counter, elementRegister))
        if (needsCleanup(element)) this.freeTempLoad(elementRegister)
    })
    return arrayRegister
}

module.exports = resolveArrayExpression;
