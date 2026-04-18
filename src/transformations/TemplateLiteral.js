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

const {log, LogData} = require("../utils/log");
const {Opcode, BytecodeValue} = require("../utils/assembler");
const {needsCleanup} = require("../utils/constants");

// ALWAYS produces a mutable result, ownership is transferred to the caller
function resolveTemplateLiteral(node) {
    const {expressions, quasis} = node

    log(`Resolving template literal: ${quasis.map(q => q.value.raw).join(', ')}`)

    const outputString = new BytecodeValue('', this.getAvailableTempLoad());
    this.chunk.append(outputString.getLoadOpcode(this.endian));
    const outputRegister = outputString.register;

    for (let i = 0; i < quasis.length; i++) {
        const quasi = quasis[i]
        const quasiRegister = this.getAvailableTempLoad()
        const stringValue = new BytecodeValue(quasi.value.raw, quasiRegister);
        this.chunk.append(stringValue.getLoadOpcode(this.endian));
        this.chunk.append(new Opcode('ADD', outputRegister, outputRegister, quasiRegister));
        this.freeTempLoad(quasiRegister)

        if (i < expressions.length) {
            const expression = expressions[i]
            const expressionRegister = this.resolveExpression(expression).outputRegister
            this.chunk.append(new Opcode('ADD', outputRegister, outputRegister, expressionRegister))
            if (needsCleanup(expression)) this.freeTempLoad(expressionRegister)
        }
    }

    return outputRegister
}

module.exports = resolveTemplateLiteral;
