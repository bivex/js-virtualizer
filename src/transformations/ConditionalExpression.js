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

// MUTABLE result, ownership is always passed to caller
function resolveConditionalExpression(node) {
    const {test, consequent, alternate} = node;

    if (!alternate) {
        log('No alternate!')
        throw new Error("No alternate clause found in conditional expression")
    }

    log(new LogData(`Resolving conditional clause (ternary)`, 'accent', true))

    const {outputRegister: testRegister, borrowed} = this.resolveExpression(test, {
        forceImmutableMerges: true
    })

    const testResult = borrowed ? this.getAvailableTempLoad() : testRegister
    const outputRegister = this.getAvailableTempLoad()
    this.chunk.append(new Opcode('TEST', testResult, testRegister))
    const jumpIP = this.chunk.getCurrentIP()
    const alternateJumpOpcode = new Opcode('JUMP_NOT_EQ', testResult, this.encodeDWORD(0))
    this.chunk.append(alternateJumpOpcode)

    if (borrowed) this.freeTempLoad(testResult)
    if (needsCleanup(test)) this.freeTempLoad(testRegister)

    const consequentResult = this.resolveExpression(consequent).outputRegister
    this.chunk.append(new Opcode('SET_REF', outputRegister, consequentResult))
    if (needsCleanup(consequent)) this.freeTempLoad(consequentResult)

    const endJumpIP = this.chunk.getCurrentIP()
    const endJumpOpcode = new Opcode('JUMP_UNCONDITIONAL', this.encodeDWORD(0))
    this.chunk.append(endJumpOpcode)

    const alternateJumpDistance = this.chunk.getCurrentIP() - jumpIP
    alternateJumpOpcode.modifyArgs(testResult, this.encodeDWORD(alternateJumpDistance))

    const alternateResult = this.resolveExpression(alternate).outputRegister
    this.chunk.append(new Opcode('SET_REF', outputRegister, alternateResult))
    if (needsCleanup(alternate)) this.freeTempLoad(alternateResult)

    const endJumpDistance = this.chunk.getCurrentIP() - endJumpIP
    endJumpOpcode.modifyArgs(this.encodeDWORD(endJumpDistance))

    return outputRegister
}

module.exports = resolveConditionalExpression;
