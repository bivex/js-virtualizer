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
const {needsCleanup, updateOperatorToOpcode} = require("../utils/constants");

// ALWAYS produces a mutable result, ownership is transferred to the caller
function resolveUpdateExpression(node) {
    const {argument, operator} = node;
    const opcode = updateOperatorToOpcode(operator);
    const {outputRegister: argumentRegister} = this.resolveExpression(argument)
    this.chunk.append(new Opcode(opcode, argumentRegister));
    return argumentRegister
}

module.exports = resolveUpdateExpression;
