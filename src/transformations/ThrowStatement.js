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
const {needsCleanup} = require("../utils/constants");

// VOID result, all registers are cleaned up before returning
function resolveThrowStatement(expression) {
    const argument = this.resolveExpression(expression.argument).outputRegister
    this.chunk.append(new Opcode('THROW_ARGUMENT', argument))
    if (needsCleanup(expression.argument)) this.freeTempLoad(argument)
}

module.exports = resolveThrowStatement;
