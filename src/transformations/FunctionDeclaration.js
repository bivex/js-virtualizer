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

const {Opcode, encodeDWORD, encodeArrayRegisters} = require("../utils/assembler");
const {log, LogData} = require("../utils/log");
const {registerNames, needsCleanup} = require("../utils/constants");
const {shuffle} = require("../utils/random");
const walk = require("acorn-walk");

function usesIdentifier(node, name) {
    let found = false;

    walk.simple(node, {
        Identifier(identifier) {
            if (identifier.name === name) {
                found = true;
            }
        }
    });

    return found;
}

// always returns a MUTABLE register, ownership is transferred to the caller
function resolveFunctionDeclaration(node, options) {
    options = options || {}
    options.declareName = options.declareName ?? `anonymous_${this.generateOpcodeLabel()}`
    options.declareRegister = options.declareRegister ?? this.randomRegister()
    options.selfName = options.selfName ?? (node.id ? node.id.name : null)
    const hasDynamicThis = node.type !== 'ArrowFunctionExpression'
    const isAsync = !!node.async
    const usesArguments = hasDynamicThis && usesIdentifier(node.body, 'arguments')

    if (options.declareName) {
        log(new LogData(`Declaring function ${options.declareName} at register ${options.declareRegister}`, 'accent', true))
        this.declareVariable(options.declareName, options.declareRegister)
    } else {
        log(new LogData(`Declaring anonymous function at register ${options.declareRegister}`, 'accent', true))
    }

    const {params, body} = node;
    const label = this.generateOpcodeLabel()
    const outputRegister = this.getAvailableTempLoad()
    const argMap = []
    const captureMappings = []

    const jumpOverIP = this.chunk.getCurrentIP()
    const jumpOver = new Opcode('JUMP_UNCONDITIONAL', encodeDWORD(0))
    this.chunk.append(jumpOver)
    const hasDefault = []
    const argRegisters = new Set()
    let thisRegister = null

    const lastIsRest = params.length && params[params.length - 1].type === 'RestElement'

    this.enterVFuncContext(label, {
        selfName: options.declareName,
        selfRegister: options.declareRegister
    })

    if (options.selfName && options.selfName !== options.declareName) {
        this.declareVariable(options.selfName, options.declareRegister, {
            functionScoped: true
        })
    }

    if (hasDynamicThis) {
        this.declareVariable('this')
        thisRegister = this.getVariable('this')
        argRegisters.add(thisRegister)
    }

    let argumentsRegister = null
    if (usesArguments && !params.some((param) => param.type === 'Identifier' && param.name === 'arguments')) {
        this.declareVariable('arguments', undefined, {
            functionScoped: true
        })
        argumentsRegister = this.getVariable('arguments')
        argRegisters.add(argumentsRegister)
    }

    for (const param of params) {
        switch (param.type) {
            case 'AssignmentPattern': {
                const {left} = param
                this.declareVariable(left.name)
                argRegisters.add(this.getVariable(left.name))
                argMap.push(this.getVariable(left.name))
                hasDefault.push(param)
                break
            }
            case 'Identifier': {
                this.declareVariable(param.name);
                argRegisters.add(this.getVariable(param.name))
                argMap.push(this.getVariable(param.name))
                break
            }
            case 'RestElement': {
                const {argument} = param
                this.declareVariable(argument.name)
                argRegisters.add(this.getVariable(argument.name))
                argMap.push(this.getVariable(argument.name))
                break
            }
            default: {
                throw new Error(`Unsupported vfunc argument type: ${param.type}`)
            }
        }
    }
    const argOrder = shuffle(Array.from({length: argMap.length}, (_, index) => index));
    const scrambledArgMap = argOrder.map((index) => argMap[index]);
    const startIP = this.chunk.getCurrentIP()
    for (const param of hasDefault) {
        this.resolveExpression(param)
    }
    this.generate(body.body, {functionScope: true})

    for (const {captureRegister, sourceRegister} of this.vfuncReferences[this.vfuncReferences.length - 1].values()) {
        if (sourceRegister === options.declareRegister) {
            log(new LogData(`Skipping recursive call capture for ${options.declareName}`, 'accent', true))
            continue
        }
        if (argRegisters.has(sourceRegister)) {
            log(new LogData(`Skipping argument capture source ${sourceRegister}`, 'accent', true))
            continue
        }
        captureMappings.push(captureRegister, sourceRegister)
    }

    const processStack = this.getProcessStack('vfunc')

    while (processStack.length) {
        const top = processStack[processStack.length - 1]
        if (top.label !== label) {
            break
        }
        const {type, computedOutput} = top.metadata
        switch (type) {
            case 'vfunc_return': {
                log(new LogData(`Detected vfunc return at ${computedOutput}!`, 'accent', true))
                top.modifyArgs(outputRegister, computedOutput)
                break
            }
            default: {
                throw new Error(`Unknown vfunc process: ${type}`)
            }
        }
        processStack.pop()
    }
    // if it did not return before this point, we need to return nothing
    this.chunk.append(new Opcode('SET_UNDEFINED', outputRegister))
    this.chunk.append(new Opcode('END'))
    this.exitVFuncContext()
    jumpOver.modifyArgs(encodeDWORD(this.chunk.getCurrentIP() - jumpOverIP))
    this.chunk.append(new Opcode('VFUNC_SETUP_CALLBACK', encodeDWORD(startIP - this.chunk.getCurrentIP()),
        options.declareRegister, outputRegister, isAsync ? 1 : 0, hasDynamicThis ? 1 : 0, hasDynamicThis ? thisRegister : 0, usesArguments ? 1 : 0, usesArguments ? argumentsRegister : 0, lastIsRest ? 1 : 0, encodeArrayRegisters(scrambledArgMap), encodeArrayRegisters(argOrder), encodeArrayRegisters(captureMappings)))
    this.freeTempLoad(outputRegister)

    return {
        outputRegister: options.declareRegister,
        dependencies: captureMappings.filter((_, index) => index % 2 === 1),
        name: options.declareName
    }
}

module.exports = resolveFunctionDeclaration
