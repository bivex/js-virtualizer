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

function resolveAwaitExpression(expression) {
    const {outputRegister: sourceRegister} = this.resolveExpression(expression.argument)
    const outputRegister = this.getAvailableTempLoad()

    this.chunk.append(new Opcode("AWAIT", outputRegister, sourceRegister))
    if (this.TLMap[sourceRegister] && sourceRegister !== outputRegister) {
        this.freeTempLoad(sourceRegister)
    }

    return {
        outputRegister,
        borrowed: false
    }
}

module.exports = resolveAwaitExpression;
