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
const {Opcode} = require("../utils/assembler");
const assert = require("assert");

// VOID result, all registers are cleaned up before returning
function resolveTryStatement(node) {
    const {block, handler, finalizer} = node;

    log(new LogData(`Resolving try statement`, 'accent', true))

    const startIP = this.chunk.getCurrentIP()
    const errorRegister = this.getAvailableTempLoad()
    const catchOpcode = new Opcode('TRY_CATCH_FINALLY', errorRegister, this.encodeDWORD(0), this.encodeDWORD(0))

    this.chunk.append(catchOpcode)
    this.handleNode(block)
    this.chunk.append(new Opcode('END'))
    if (handler.param) assert(handler.param.type === 'Identifier', 'Catch block must have an identifier as a parameter')
    this.declareVariable(handler.param.name, errorRegister)
    const catchIP = this.chunk.getCurrentIP()
    this.handleNode(handler.body)
    this.chunk.append(new Opcode('END'))
    const finallyIP = this.chunk.getCurrentIP()
    if (finalizer) this.handleNode(finalizer)
    this.chunk.append(new Opcode('END'))

    catchOpcode.modifyArgs(errorRegister, this.encodeDWORD(catchIP - startIP), this.encodeDWORD(finallyIP - startIP))

    this.freeTempLoad(errorRegister)
}

module.exports = resolveTryStatement;
