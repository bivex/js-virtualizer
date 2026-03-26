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
const {Opcode} = require("../utils/assembler");
const {binaryOperatorToOpcode, needsCleanup} = require("../utils/constants");

// ALWAYS produces a copy of result, ownership of the copy is passed to the caller
function resolveAssignmentExpression(node) {
    const {left, right, operator} = node;
    let leftRegister
    let leftObjectRegister
    let leftPropertyRegister

    if (left.type === 'MemberExpression') {
        leftObjectRegister = this.resolveExpression(left.object).outputRegister
        leftPropertyRegister = this.resolveExpression(left.property, {computed: left.computed}).outputRegister
    } else {
        leftRegister = this.resolveExpression(left).outputRegister
    }
    let rightRegister
    if (left.type === 'Identifier') {
        const name = left.name
        if (this.activeVFunctions[name]) {

        }
        switch (right.type) {
            case 'FunctionExpression':
            case 'ArrowFunctionExpression':
            case 'FunctionDeclaration': {
                this.resolveFunctionDeclaration(right, {
                    declareName: name
                })
                rightRegister = this.getVariable(left.name)
                break
            }
        }
    }

    if (!rightRegister) rightRegister = this.resolveExpression(right).outputRegister

    switch (operator) {
        case '=': {
            if (left.type === 'MemberExpression') {
                log(`Evaluating regular assignment expression with SET_PROP`)
                this.chunk.append(new Opcode('SET_PROP', leftObjectRegister, leftPropertyRegister, rightRegister));
            } else {
                log(`Evaluating regular assignment expression with SET_REF`)
                this.chunk.append(new Opcode('SET_REF', leftRegister, rightRegister));
            }
            break;
        }
        default: {
            if (left.type === 'MemberExpression') {
                throw new Error(`Unsupported assignment operator for MemberExpression: ${operator}`)
            }
            const opcode = binaryOperatorToOpcode(operator.slice(0, -1));
            log(`Evaluating inclusive assignment expression with ${operator} using ${opcode}`)
            this.chunk.append(new Opcode(opcode, leftRegister, leftRegister, rightRegister));
        }
    }

    const outputRegister = this.getAvailableTempLoad()
    this.chunk.append(new Opcode('SET_REF', outputRegister, left.type === 'MemberExpression' ? rightRegister : leftRegister))

    if (needsCleanup(left) && leftRegister !== undefined) this.freeTempLoad(leftRegister)
    if (this.TLMap[leftObjectRegister]) this.freeTempLoad(leftObjectRegister)
    if (this.TLMap[leftPropertyRegister]) this.freeTempLoad(leftPropertyRegister)
    if (needsCleanup(right)) this.freeTempLoad(rightRegister)

    return outputRegister
}

module.exports = resolveAssignmentExpression;
