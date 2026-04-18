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

const {VMChunk, Opcode, encodeDWORD, encodeString: _encodeString, BytecodeValue} = require("./assembler");
const crypto = require("crypto");
const {registerNames, binaryOperatorToOpcode, needsCleanup} = require("./constants");
const {log, LogData} = require("./log");
const resolveBinaryExpression = require("../transformations/BinaryExpression");
const resolveMemberExpression = require("../transformations/MemberExpression");
const resolveCallExpression = require("../transformations/CallExpression");
const resolveObjectExpression = require("../transformations/ObjectExpression");
const resolveArrayExpression = require("../transformations/ArrayExpression");
const resolveNewExpression = require("../transformations/NewExpression");
const resolveExpression = require("../transformations/resolveToRegister");
const resolveIfStatement = require("../transformations/IfStatement");
const resolveUnaryExpression = require("../transformations/UnaryExpression");
const resolveUpdateExpression = require("../transformations/UpdateExpression");
const resolveForStatement = require("../transformations/ForStatement");
const resolveWhileStatement = require("../transformations/WhileStatement");
const resolveForOfStatement = require("../transformations/ForOfStatement");
const resolveForInStatement = require("../transformations/ForInStatement");
const resolveFunctionDeclaration = require("../transformations/FunctionDeclaration");
const resolveLogicalExpression = require("../transformations/LogicalExpression");
const resolveConditionalExpression = require("../transformations/ConditionalExpression");
const resolveTemplateLiteral = require("../transformations/TemplateLiteral");
const resolveSpreadElement = require("../transformations/SpreadElement");
const resolveAssignmentPattern = require("../transformations/AssignmentPattern");
const assert = require("node:assert");
const resolveAwaitExpression = require("../transformations/AwaitExpression");
const resolveTryStatement = require("../transformations/TryStatement");
const resolveThrowStatement = require("../transformations/ThrowStatement");
const resolveSequenceExpression = require("../transformations/SequenceExpression");
const resolveAssignmentExpression = require("../transformations/AssignmentExpression");
const resolveSwitchStatement = require("../transformations/SwitchStatement");

const TL_COUNT = 30
const DEFAULT_REGISTER_COUNT = 256

class FunctionBytecodeGenerator {
    constructor(ast, chunk, options = {}) {
        this.ast = ast;
        this.chunk = chunk || new VMChunk();
        this.registerCount = Number.isInteger(options.registerCount)
            ? Math.max(registerNames.length + 1, Math.min(options.registerCount, DEFAULT_REGISTER_COUNT))
            : DEFAULT_REGISTER_COUNT;
        this.reservedRegisters = new Set()
        if (options.cffStateRegister !== undefined) {
            this.reservedRegisters.add(options.cffStateRegister);
        }
        this.registerScrambleMap = options.registerScrambleMap || null;
        this.reverseScrambleMap = options.reverseScrambleMap || null;
        this.endian = options.endian || "BE";
        this.outputRegister = this.randomRegister();

        // for arithmetics and loading values
        // binary expressions and member expressions need 4 TL each
        // call expressions need 6 (too lazy to calculate actual value, this is just a guess)
        this.available = {}
        this.TLMap = {}
        for (let i = 1; i <= TL_COUNT; i++) {
            const regName = `TL${i}`
            this[regName] = this.randomRegister();
            this.TLMap[this[regName]] = regName
            this.available[regName] = true
        }
        log(new LogData(`Output register: ${this.outputRegister}`, 'accent', false))

        // for variable contexts
        // variables declared by the scope, array of array of variable names
        // 0th element is the global scope, subsequent elements are nested scopes
        this.activeScopes = [[]]
        this.functionScopeIndices = [0]
        // variables that are currently in the active scope, map of variable name to array of registers,
        // where the last element is the most recent register (active reference)
        this.activeVariables = {}
        this.takenLabels = new Set()
        // labels that need to be resolved
        this.processStack = {
            loops: [],
            vfunc: [],
            switch: []
        }
        // a bunch of stacks which contain the current relevant label for each context
        this.contextLabels = {
            loops: [],
            vfunc: [],
            switch: []
        }
        this.activeLabels = []
        // like activeVariables but for functions
        // contains important information such as the IP of the function, register map for the arguments, dependencies, etc.
        this.activeVFunctions = {}
        // for variables that are out of current scope but still accessible
        // ie. by functions
        this.dropDefers = {}
        this.vfuncReferences = []
        this.vfuncCaptureBindings = []
        this.activeVFuncMetadata = []
        this.capturedRegisters = new Set()

        this.resolveExpression = resolveExpression.bind(this)
        this.resolveBinaryExpression = resolveBinaryExpression.bind(this)
        this.resolveLogicalExpression = resolveLogicalExpression.bind(this)
        this.resolveMemberExpression = resolveMemberExpression.bind(this)
        this.resolveCallExpression = resolveCallExpression.bind(this)
        this.resolveObjectExpression = resolveObjectExpression.bind(this)
        this.resolveArrayExpression = resolveArrayExpression.bind(this)
        this.resolveNewExpression = resolveNewExpression.bind(this)
        this.resolveUnaryExpression = resolveUnaryExpression.bind(this)
        this.resolveUpdateExpression = resolveUpdateExpression.bind(this)
        this.resolveConditionalExpression = resolveConditionalExpression.bind(this)
        this.resolveTemplateLiteral = resolveTemplateLiteral.bind(this)
        this.resolveSpreadElement = resolveSpreadElement.bind(this)
        this.resolveAssignmentPattern = resolveAssignmentPattern.bind(this)
        this.resolveAwaitExpression = resolveAwaitExpression.bind(this)
        this.resolveThrowStatement = resolveThrowStatement.bind(this)
        this.resolveSequenceExpression = resolveSequenceExpression.bind(this)
        this.resolveAssignmentExpression = resolveAssignmentExpression.bind(this)

        this.resolveIfStatement = resolveIfStatement.bind(this)
        this.resolveForStatement = resolveForStatement.bind(this)
        this.resolveForOfStatement = resolveForOfStatement.bind(this)
        this.resolveForInStatement = resolveForInStatement.bind(this)
        this.resolveWhileStatement = resolveWhileStatement.bind(this)
        this.resolveFunctionDeclaration = resolveFunctionDeclaration.bind(this)
        this.resolveTryStatement = resolveTryStatement.bind(this)
        this.resolveSwitchStatement = resolveSwitchStatement.bind(this)
    }

    encodeDWORD(dword) {
        return encodeDWORD(dword, this.endian);
    }

    encodeString(str) {
        return _encodeString(str, this.endian);
    }

    dropVariable(variableName) {
        if (!this.activeVariables[variableName]) {
            log(new LogData(`Attempted to drop variable ${variableName} which is not in scope! Skipping`, 'warn', false))
            return
        }
        const {register} = this.activeVariables[variableName].pop()
        if (this.activeVariables[variableName].length === 0) {
            delete this.activeVariables[variableName]
        }
        if (this.capturedRegisters.has(register)) {
            this.chunk.append(new Opcode('DETACH_REF', register))
            this.capturedRegisters.delete(register)
        }
        this.removeRegister(register)
    }

    declareVariable(variableName, register, options) {
        options = options ?? {}
        const scopeIndex = options.scopeIndex ?? (options.functionScoped ? this.functionScopeIndices[this.functionScopeIndices.length - 1] : this.activeScopes.length - 1)
        log(new LogData(`Declaring variable ${variableName} at register ${register ?? 'random'}`, 'accent'))
        if (!this.activeVariables[variableName]) {
            this.activeVariables[variableName] = []
        }
        this.activeScopes[scopeIndex].push(variableName)
        this.activeVariables[variableName].push({
            register: register ?? this.randomRegister(),
            metadata: {
                vfuncContext: this.getActiveLabel('vfunc') ?? 'outside_of_vfunc'
            }
        })
    }

    getVariable(variableName) {
        log(`Getting variable ${variableName}`)
        const scopeArray = this.activeVariables[variableName]
        if (!scopeArray) {
            log(new LogData(`Variable ${variableName} not found in scope!`, 'error', false))
            throw new Error(`Variable ${variableName} not found in scope!`)
        }
        const accessContext = this.getActiveLabel('vfunc')
        if (accessContext) {
            const currentContextIndex = this.activeVFuncMetadata.length - 1
            let {register, metadata} = scopeArray[scopeArray.length - 1]
            const sourceContextIndex = this.findVFuncContextIndex(metadata.vfuncContext)

            for (let contextIndex = Math.max(sourceContextIndex + 1, 0); contextIndex < currentContextIndex; contextIndex++) {
                this.captureVariableIntoContext(variableName, contextIndex);
                ({register, metadata} = scopeArray[scopeArray.length - 1])
            }

            if (metadata.vfuncContext !== accessContext) {
                log(new LogData(`VFunc capturing variable ${variableName} by reference! Current Context: ${accessContext}, Variable Context: ${metadata.vfuncContext}`, 'warn'))
                return this.captureVariableIntoContext(variableName, currentContextIndex)
            }
            return register
        }
        const {register} = scopeArray[scopeArray.length - 1]
        return register
    }

    removeRegister(register) {
        if (this.dropDefers[register] && this.dropDefers[register] > 0) {
            log(new LogData(`Prohibiting dropping of required register ${register}`, 'warn'))
            return
        }
        if (this.reverseScrambleMap) {
            const logicalIdx = this.reverseScrambleMap.get(register);
            if (logicalIdx !== undefined) {
                this.reservedRegisters.delete(logicalIdx);
                return;
            }
        }
        this.reservedRegisters.delete(register);
    }

    deferDrop(register) {
        if (!this.dropDefers[register]) this.dropDefers[register] = 0
        this.dropDefers[register] += 1
    }

    releaseDefer(register) {
        if (!this.dropDefers[register]) {
            log(new LogData(`Attempted to release defer on register ${register} which is not deferred! Skipping`, 'warn', false))
            return
        }
        this.dropDefers[register] -= 1
        if (this.dropDefers[register] === 0) {
            log(new LogData(`Register ${register} has no more dependencies and can be dropped`, 'accent', false))
            this.removeRegister(register)
        }
    }

    registerVFunction(name, metadata) {
        const register = this.getVariable(name)
        if (this.activeVFunctions[register]) {
            log(new LogData(`Function ${name} already registered at register ${register}! Overwriting`, 'warn', false))
            this.releaseVFunction(name)
        }
        this.activeVFunctions[register] = {
            name,
            metadata
        }
    }

    releaseVFunction(name) {
        const register = this.getVariable(name)
        if (!this.activeVFunctions[register]) {
            log(new LogData(`Attempted to release a non-existant vfunction ${name} at register ${register}! Skipping`, 'warn', false))
            return
        }
        const activeVFunction = this.activeVFunctions[register]
        for (const borrowed of activeVFunction.metadata.dependencies) {
            this.releaseDefer(borrowed)
        }
        delete this.activeVFunctions[register]
    }

    randomRegister() {
        const availableRegisterCount = this.registerCount - registerNames.length;
        if (this.reservedRegisters.size >= availableRegisterCount) {
            throw new Error(`No free VM registers available for registerCount=${this.registerCount}`);
        }

        let register = crypto.randomInt(registerNames.length, this.registerCount);
        let attempts = 0;
        const maxAttempts = Math.max(availableRegisterCount * 2, 32);
        while (this.reservedRegisters.has(register)) {
            attempts += 1;
            if (attempts >= maxAttempts) {
                throw new Error(`Failed to allocate a free VM register for registerCount=${this.registerCount}`);
            }
            register = crypto.randomInt(registerNames.length, this.registerCount);
        }
        this.reservedRegisters.add(register);

        if (this.registerScrambleMap) {
            const scrambled = this.registerScrambleMap.get(register);
            if (scrambled !== undefined) return scrambled;
        }
        return register;
    }

    getAvailableTempLoad() {
        for (const [register, available] of Object.entries(this.available)) {
            if (available) {
                log(new LogData(`Allocating temp load register ${register}`, 'accent'))
                this.available[register] = false
                return this[register]
            }
        }
        log(new LogData('No available temp load registers!', 'error', false))
    }

    // remember to free the tempload after using it
    freeTempLoad(register) {
        if (this.available[this.TLMap[register]]) {
            log(new LogData(`Attempted to free already available temp load register ${this.TLMap[register]}`, 'warn'))
            return
        }
        if (!this.TLMap[register]) {
            log(new LogData(`Attempted to free non-tempload register ${register}! Skipping`, 'warn'))
            return
        }
        log(new LogData(`Freeing temp load register ${this.TLMap[register]} (${register})`, 'accent'))
        this.available[this.TLMap[register]] = true
    }

    generateOpcodeLabel() {
        while (true) {
            const label = crypto.randomBytes(16).toString('hex')
            if (!this.takenLabels.has(label)) {
                this.takenLabels.add(label)
                return label
            }
        }
    }

    enterVFuncContext(label, metadata) {
        this.contextLabels.vfunc.push(label)
        this.vfuncReferences.push(new Map())
        this.vfuncCaptureBindings.push([])
        this.activeVFuncMetadata.push({
            label,
            selfName: metadata?.selfName ?? null,
            selfRegister: metadata?.selfRegister ?? null
        })
    }

    exitVFuncContext() {
        this.contextLabels.vfunc.pop()
        const captureBindings = this.vfuncCaptureBindings.pop()
        for (let i = captureBindings.length - 1; i >= 0; i--) {
            const {name, captureRegister} = captureBindings[i]
            const scopeArray = this.activeVariables[name]
            if (scopeArray && scopeArray.length > 0) {
                const top = scopeArray[scopeArray.length - 1]
                if (top.register === captureRegister && top.metadata?.syntheticCapture) {
                    scopeArray.pop()
                    if (scopeArray.length === 0) {
                        delete this.activeVariables[name]
                    }
                }
            }
            this.removeRegister(captureRegister)
        }
        this.vfuncReferences.pop()
        this.activeVFuncMetadata.pop()
    }

    findVFuncContextIndex(label) {
        if (!label || label === 'outside_of_vfunc') {
            return -1
        }
        for (let i = this.activeVFuncMetadata.length - 1; i >= 0; i--) {
            if (this.activeVFuncMetadata[i].label === label) {
                return i
            }
        }
        return -1
    }

    captureVariableIntoContext(variableName, contextIndex) {
        const scopeArray = this.activeVariables[variableName]
        const {register, metadata} = scopeArray[scopeArray.length - 1]
        const targetContext = this.activeVFuncMetadata[contextIndex]
        if (!targetContext || metadata.vfuncContext === targetContext.label) {
            return register
        }
        if (targetContext.selfName === variableName && targetContext.selfRegister === register) {
            return register
        }
        const referenceMap = this.vfuncReferences[contextIndex]
        const existing = referenceMap.get(variableName)
        if (existing) {
            return existing.captureRegister
        }
        const captureRegister = this.randomRegister()
        referenceMap.set(variableName, {
            name: variableName,
            captureRegister,
            sourceRegister: register
        })
        this.vfuncCaptureBindings[contextIndex].push({
            name: variableName,
            captureRegister
        })
        this.capturedRegisters.add(register)
        scopeArray.push({
            register: captureRegister,
            metadata: {
                vfuncContext: targetContext.label,
                syntheticCapture: true,
                sourceRegister: register
            }
        })
        return captureRegister
    }

    getCapturedScopeRegisters() {
        const captured = []
        const seenVariables = new Set()

        for (let scopeIndex = this.activeScopes.length - 1; scopeIndex >= 0; scopeIndex--) {
            const scope = this.activeScopes[scopeIndex]
            for (let i = scope.length - 1; i >= 0; i--) {
                const variableName = scope[i]
                if (seenVariables.has(variableName)) {
                    continue
                }
                seenVariables.add(variableName)
                const binding = this.activeVariables[variableName]?.[this.activeVariables[variableName].length - 1]
                if (binding && this.capturedRegisters.has(binding.register)) {
                    captured.push(binding.register)
                }
            }
        }

        return captured
    }

    emitDetachForRegisters(registers) {
        const emitted = new Set()
        for (const register of registers) {
            if (emitted.has(register)) {
                continue
            }
            emitted.add(register)
            this.chunk.append(new Opcode('DETACH_REF', register))
        }
    }

    enterContext(type, label) {
        this.contextLabels[type].push(label)
        this.activeLabels.push({
            type,
            label
        })
    }

    contextProcess(type, opcode) {
        this.processStack[type].push(opcode)
    }

    getProcessStack(type) {
        return this.processStack[type]
    }

    exitContext(type) {
        this.contextLabels[type].pop()
        this.activeLabels.pop()
    }

    getActiveLabel(type) {
        return this.contextLabels[type][this.contextLabels[type].length - 1]
    }

    findFirstLabelOfTypes(types) {
        const lookingFor = new Set(types)
        let idx = this.activeLabels.length - 1
        while (idx >= 0) {
            const {type, label} = this.activeLabels[idx]
            if (lookingFor.has(type)) return {
                label,
                type
            }
            idx -= 1
        }
        return null
    }

    // this is probably an expression
    handleNode(node) {
        if (!node) {
            log(new LogData('Attempted to handle null node! Skipping', 'warn', false))
            return
        }
        // for vfuncs
        if (needsCleanup(node)) {
            const out = this.resolveExpression(node).outputRegister
            this.freeTempLoad(out)
            return
        }
        switch (node.type) {
            case 'BlockStatement': {
                this.generate(node.body);
                break;
            }
            case 'IfStatement': {
                this.resolveIfStatement(node)
                break;
            }
            case 'SwitchStatement': {
                this.resolveSwitchStatement(node)
                break
            }
            case 'TryStatement': {
                this.resolveTryStatement(node)
                break
            }
            case 'ThrowStatement': {
                this.resolveThrowStatement(node)
                break
            }
            case 'ForStatement': {
                this.resolveForStatement(node)
                break
            }
            case 'ForOfStatement': {
                this.resolveForOfStatement(node)
                break
            }
            case 'ForInStatement': {
                this.resolveForInStatement(node)
                break
            }
            case 'WhileStatement': {
                this.resolveWhileStatement(node)
                break
            }
            case 'VariableDeclaration': {
                for (const declaration of node.declarations) {
                    if (declaration.id.type === 'ArrayPattern') {
                        const arrayRegister = this.resolveExpression(declaration.init).outputRegister
                        const counterRegister = this.getAvailableTempLoad()
                        const oneRegister = this.getAvailableTempLoad()

                        this.chunk.append(new Opcode('LOAD_DWORD', counterRegister, this.encodeDWORD(0)));
                        this.chunk.append(new Opcode('LOAD_DWORD', oneRegister, this.encodeDWORD(1)));

                        const functionScoped = node.kind === 'var'

                        for (let i = 0; i < declaration.id.elements.length; i++) {
                            const element = declaration.id.elements[i]
                            assert(element.type === 'Identifier', 'ArrayPattern element is not an Identifier!')
                            this.declareVariable(element.name, this.randomRegister(), {functionScoped})
                            this.chunk.append(new Opcode('GET_INDEX', this.getVariable(element.name), arrayRegister, counterRegister))
                            this.chunk.append(new Opcode('ADD', counterRegister, counterRegister, oneRegister))
                        }
                        this.freeTempLoad(counterRegister)
                        this.freeTempLoad(oneRegister)
                        if (needsCleanup(declaration.init)) this.freeTempLoad(arrayRegister)
                        continue
                    }
                    if (declaration.id.type === 'ObjectPattern') {
                        const objectRegister = this.resolveExpression(declaration.init).outputRegister
                        const functionScoped = node.kind === 'var'
                        for (const property of declaration.id.properties) {
                            const {key, value} = property
                            assert(key.type === 'Identifier', 'ObjectPattern key is not an Identifier!')
                            assert(value.type === 'Identifier', 'ObjectPattern value is not an Identifier!')
                            this.declareVariable(value.name, this.randomRegister(), {functionScoped})
                            const propRegister = this.randomRegister()
                            const prop = new BytecodeValue(key.name, propRegister)
                            this.chunk.append(prop.getLoadOpcode(this.endian))
                            this.chunk.append(new Opcode('GET_PROP', this.getVariable(value.name), objectRegister, propRegister))
                            this.freeTempLoad(propRegister)
                        }
                        if (needsCleanup(declaration.init)) this.freeTempLoad(objectRegister)
                        continue
                    }
                    if (declaration.init) {
                        let out
                        switch (declaration.init.type) {
                            case 'FunctionExpression':
                            case 'ArrowFunctionExpression':
                            case 'FunctionDeclaration': {
                                const {dependencies} = this.resolveFunctionDeclaration(declaration.init, {
                                    declareName: declaration.id.name,
                                    functionScoped: node.kind === 'var'
                                })
                                return;
                            }
                            default: {
                                out = this.resolveExpression(declaration.init).outputRegister
                                if (needsCleanup(declaration.init)) this.freeTempLoad(out)
                            }
                        }
                        this.declareVariable(declaration.id.name, this.randomRegister(), {
                            functionScoped: node.kind === 'var'
                        });
                        this.chunk.append(new Opcode('SET_REF', this.getVariable(declaration.id.name), out));
                        if (needsCleanup(declaration.init)) this.freeTempLoad(out)
                    } else {
                        this.declareVariable(declaration.id.name, this.randomRegister(), {
                            functionScoped: node.kind === 'var'
                        });
                        this.chunk.append(new Opcode('SET_REF', this.getVariable(declaration.id.name), 0));
                    }
                }
                break;
            }
            case 'FunctionExpression':
            case 'ArrowFunctionExpression':
            case 'FunctionDeclaration': {
                const name = node.id.name
                this.resolveFunctionDeclaration(node, {
                    declareName: name
                })
                log(`FunctionDeclaration result is at ${this.getVariable(name)}`)
                break
            }
            case 'ExpressionStatement': {
                const out = this.resolveExpression(node.expression).outputRegister
                if (needsCleanup(node.expression)) this.freeTempLoad(out)
                break
            }
            case 'BreakStatement': {
                const opcode = new Opcode('JUMP_UNCONDITIONAL', this.encodeDWORD(0))
                const {label, type} = this.findFirstLabelOfTypes(['loops', 'switch'])
                opcode.markForProcessing(label, {
                    type: 'break',
                    ip: this.chunk.getCurrentIP()
                })
                this.chunk.append(opcode)
                this.contextProcess(type, opcode)
                break
            }
            case 'ContinueStatement': {
                const opcode = new Opcode('JUMP_UNCONDITIONAL', this.encodeDWORD(0))
                opcode.markForProcessing(this.getActiveLabel('loops'), {
                    type: 'continue',
                    ip: this.chunk.getCurrentIP()
                })
                this.chunk.append(opcode)
                this.contextProcess('loops', opcode)
                break
            }
            case 'ReturnStatement': {
                const out = this.resolveExpression(node.argument).outputRegister
                if (this.getActiveLabel('vfunc')) {
                    const opcode = new Opcode('SET_REF', 0, out)
                    opcode.markForProcessing(this.getActiveLabel('vfunc'), {
                        type: 'vfunc_return',
                        computedOutput: out
                    })
                    this.chunk.append(opcode)
                    this.contextProcess('vfunc', opcode)
                    this.emitDetachForRegisters(this.getCapturedScopeRegisters())
                    this.chunk.append(new Opcode('END'))
                } else {
                    this.chunk.append(new Opcode('SET_REF', this.outputRegister, out));
                    this.emitDetachForRegisters(this.getCapturedScopeRegisters())
                    this.chunk.append(new Opcode('END'))
                }
                if (needsCleanup(node.argument)) this.freeTempLoad(out)
            }
        }
    }

    // generate bytecode for all converted values
    generate(block, options) {
        block = block ?? this.ast
        options = options ?? {}
        options.functionScope = options.functionScope ?? (this.activeScopes.length === 1)

        this.activeScopes.push([])
        if (options.functionScope) {
            this.functionScopeIndices.push(this.activeScopes.length - 1)
        }
        // perform a DFS on the block
        for (const node of block) {
            this.handleNode(node, options)
        }
        // discard all variables in the current scope
        const scope = this.activeScopes.pop()
        for (const variableName of scope) {
            log(new LogData(`Dropping variable ${variableName}`, 'accent'))
            this.dropVariable(variableName)
        }
        if (options.functionScope) {
            this.functionScopeIndices.pop()
        }
    }

    getBytecode() {
        log(`\nResulting Bytecode:\n\n${this.chunk.toString()}`)
        return this.chunk.toBytes();
    }
}

module.exports = {
    DEFAULT_REGISTER_COUNT,
    FunctionBytecodeGenerator
};
