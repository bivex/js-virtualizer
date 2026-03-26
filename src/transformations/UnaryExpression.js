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

const {Opcode} = require("../utils/assembler");
const {unaryOperatorToOpcode, needsCleanup} = require("../utils/constants");

// ALWAYS produces a mutable result, ownership is transferred to the caller
function resolveUnaryExpression(node, forceImmutableMerges) {
    const {argument, operator} = node;
    const opcode = unaryOperatorToOpcode(operator);
    const {outputRegister: argumentRegister, borrowed} = this.resolveExpression(argument)
    let mergeTo = (borrowed || forceImmutableMerges) ? this.getAvailableTempLoad() : argumentRegister
    this.chunk.append(new Opcode(opcode, mergeTo, argumentRegister));

    if (needsCleanup(argument)) this.freeTempLoad(argumentRegister)

    return mergeTo
}

module.exports = resolveUnaryExpression;
