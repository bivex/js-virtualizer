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
const {binaryOperatorToOpcode, needsCleanup} = require("../utils/constants");

// ALWAYS produces a copy of result, ownership of the copy is passed to the caller
function resolveAssignmentExpression(node) {
    const {left, right, operator} = node;
    let leftRegister
    let leftObjectRegister
    let leftPropertyRegister
    let patternAssignment = false

    if (left.type === 'MemberExpression') {
        leftObjectRegister = this.resolveExpression(left.object).outputRegister
        leftPropertyRegister = this.resolveExpression(left.property, {computed: left.computed}).outputRegister
    } else if (left.type === 'ArrayPattern' || left.type === 'ObjectPattern') {
        patternAssignment = true
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
            } else if (left.type === 'ArrayPattern') {
                log(`Evaluating array destructuring assignment expression`)
                const counterRegister = this.getAvailableTempLoad()
                const oneRegister = this.getAvailableTempLoad()
                this.chunk.append(new Opcode('LOAD_DWORD', counterRegister, this.encodeDWORD(0)));
                this.chunk.append(new Opcode('LOAD_DWORD', oneRegister, this.encodeDWORD(1)));

                for (const element of left.elements) {
                    if (element && element.type === 'Identifier') {
                        this.chunk.append(new Opcode('GET_INDEX', this.getVariable(element.name), rightRegister, counterRegister));
                    }
                    this.chunk.append(new Opcode('ADD', counterRegister, counterRegister, oneRegister))
                }

                this.freeTempLoad(counterRegister)
                this.freeTempLoad(oneRegister)
            } else if (left.type === 'ObjectPattern') {
                log(`Evaluating object destructuring assignment expression`)
                for (const property of left.properties) {
                    const {key, value} = property
                    if (value.type !== 'Identifier') {
                        throw new Error(`Unsupported ObjectPattern assignment target: ${value.type}`)
                    }
                    const propRegister = this.getAvailableTempLoad()
                    const prop = new BytecodeValue(key.type === 'Identifier' ? key.name : key.value, propRegister)
                    this.chunk.append(prop.getLoadOpcode(this.endian))
                    this.chunk.append(new Opcode('GET_PROP', this.getVariable(value.name), rightRegister, propRegister))
                    this.freeTempLoad(propRegister)
                }
            } else {
                log(`Evaluating regular assignment expression with SET_REF`)
                this.chunk.append(new Opcode('SET_REF', leftRegister, rightRegister));
            }
            break;
        }
        default: {
            if (left.type === 'MemberExpression' || patternAssignment) {
                throw new Error(`Unsupported assignment operator for MemberExpression: ${operator}`)
            }
            const opcode = binaryOperatorToOpcode(operator.slice(0, -1));
            log(`Evaluating inclusive assignment expression with ${operator} using ${opcode}`)
            this.chunk.append(new Opcode(opcode, leftRegister, leftRegister, rightRegister));
        }
    }

    const outputRegister = this.getAvailableTempLoad()
    this.chunk.append(new Opcode('SET_REF', outputRegister, (left.type === 'MemberExpression' || patternAssignment) ? rightRegister : leftRegister))

    if (needsCleanup(left) && leftRegister !== undefined) this.freeTempLoad(leftRegister)
    if (this.TLMap[leftObjectRegister]) this.freeTempLoad(leftObjectRegister)
    if (this.TLMap[leftPropertyRegister]) this.freeTempLoad(leftPropertyRegister)
    if (needsCleanup(right)) this.freeTempLoad(rightRegister)

    return outputRegister
}

module.exports = resolveAssignmentExpression;
