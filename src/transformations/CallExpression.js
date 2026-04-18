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

const {log} = require("../utils/log");
const {Opcode, BytecodeValue} = require("../utils/assembler");
const {registers, needsCleanup} = require("../utils/constants");

// ALWAYS produces a mutable result, ownership is transferred to the caller
function resolveCallExpression(node, awaited) {
    const {callee, arguments} = node;
    awaited = awaited ?? false

    log(`Resolving call expression: ${callee.type}(${arguments.map(arg => arg.type).join(', ')})`)

    const {outputRegister: calleeRegister, metadata} = this.resolveExpression(callee, {
        forceObjectImmutability: true
    })

    log(`Resolved callee at register ${calleeRegister} with this at register ${metadata.objectRegister ?? registers.VOID}`)

    const argsRegister = this.getAvailableTempLoad()
    this.chunk.append(new Opcode('SETUP_ARRAY', argsRegister, this.encodeDWORD(arguments.length)));
    log(`Arguments allocated at ${this.TLMap[argsRegister]} (${argsRegister}) with size ${arguments.length}`)
    this.buildArrayFromItems(arguments, (arg, counter, idx) => {
        const valueRegister = this.resolveExpression(arg).outputRegister
        log(`Loaded argument ${idx} (${arg.type}) at register ${valueRegister}`)
        this.chunk.append(new Opcode('SET_INDEX', argsRegister, counter, valueRegister))
        if (needsCleanup(arg)) this.freeTempLoad(valueRegister)
    })

    const mergeTo = argsRegister
    this.chunk.append(new Opcode(awaited ? 'FUNC_ARRAY_CALL_AWAIT' : 'FUNC_ARRAY_CALL', calleeRegister, mergeTo, metadata.objectRegister ?? registers.VOID, argsRegister));
    if (needsCleanup(callee)) this.freeTempLoad(calleeRegister)

    log(`CallExpression return value is at ${this.TLMap[mergeTo]} (${mergeTo})`)

    // free this register if it's a temporary load
    if (metadata.objectRegister) this.freeTempLoad(metadata.objectRegister)

    return mergeTo
}

module.exports = resolveCallExpression;
