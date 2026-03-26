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

const acorn = require("acorn");
const walk = require("acorn-walk");
const babel = require("@babel/core");
const decoratorsPlugin = require("@babel/plugin-proposal-decorators");
const asyncGeneratorFunctionsPlugin = require("@babel/plugin-transform-async-generator-functions");
const regeneratorPlugin = require("@babel/plugin-transform-regenerator");
const eslintScope = require("eslint-scope");
const {readFileSync, writeFileSync} = require("node:fs");
const path = require("node:path");
const functionWrapperTemplate = readFileSync(path.join(__dirname, "./templates/functionWrapper.template"), "utf-8");
const requireTemplate = readFileSync(path.join(__dirname, "./templates/requireTemplate.template"), "utf-8");
const crypto = require("crypto");
const {FunctionBytecodeGenerator} = require("./utils/BytecodeGenerator");
const {Opcode, encodeDWORD, encodeString} = require("./utils/assembler");
const escodegen = require("escodegen");
const {log, LogData} = require("./utils/log");
const zlib = require("node:zlib");
const fs = require("node:fs");
const JSVM = require("./vm_dev");
const obfuscateCode = require("./postTranspilation/obfuscateCode");
const obfuscateOpcodes = require("./postTranspilation/obfuscateOpcodes");
const {desugarStatementList} = require("./utils/desugar");
const {shuffle} = require("./utils/random");

const vmDist = fs.readFileSync(path.join(__dirname, './vm_dist.js'), 'utf-8');
const encodings = ['base64']

if (!fs.existsSync(path.join(__dirname, '../output'))) fs.mkdirSync(path.join(__dirname, '../output'))

function preprocessDecorators(code, decoratorsMode) {
    try {
        acorn.parse(code, {
            ecmaVersion: "latest",
            sourceType: "module"
        });

        return code;
    } catch (error) {
        if (!String(error.message).includes("Unexpected character '@'")) {
            throw error;
        }
    }

    const transformed = babel.transformSync(code, {
        configFile: false,
        babelrc: false,
        comments: true,
        retainLines: true,
        sourceType: "module",
        plugins: [[decoratorsPlugin, decoratorsMode === "standard" ? {version: "2023-11"} : {legacy: true}]]
    });

    if (!transformed || !transformed.code) {
        throw new Error("Failed to preprocess decorators");
    }

    return transformed.code;
}

function containsGeneratorSyntax(ast) {
    let hasGenerators = false;

    walk.simple(ast, {
        FunctionDeclaration(node) {
            if (node.generator) {
                hasGenerators = true;
            }
        },
        FunctionExpression(node) {
            if (node.generator) {
                hasGenerators = true;
            }
        },
        YieldExpression() {
            hasGenerators = true;
        }
    });

    return hasGenerators;
}

function preprocessGenerators(code) {
    const transformed = babel.transformSync(code, {
        configFile: false,
        babelrc: false,
        comments: true,
        retainLines: true,
        sourceType: "module",
        plugins: [asyncGeneratorFunctionsPlugin, regeneratorPlugin]
    });

    if (!transformed || !transformed.code) {
        throw new Error("Failed to preprocess generators");
    }

    return transformed.code;
}

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

function preprocessVirtualizedFunctionDeclaration(node, code) {
    const transformedCode = preprocessGenerators(code.slice(node.start, node.end));
    const transformedStatements = acorn.parse(transformedCode, {
        ecmaVersion: "latest",
        sourceType: "module",
        locations: true,
        ranges: true
    }).body;
    const target = [...transformedStatements].reverse().find((statement) => statement.type === "FunctionDeclaration" && statement.id && statement.id.name === node.id.name);

    if (!target) {
        throw new Error(`Failed to locate transformed function declaration for ${node.id?.name ?? "anonymous"}`);
    }

    target.__virtualize = true;
    return transformedStatements;
}

function preprocessVirtualizedFunctionsInList(statements, code, needToVirtualize) {
    for (let index = 0; index < statements.length; index++) {
        const statement = statements[index];

        if (!statement) {
            continue;
        }

        if (statement.type === "FunctionDeclaration") {
            if (needToVirtualize(statement)) {
                if (containsGeneratorSyntax(statement)) {
                    const replacement = preprocessVirtualizedFunctionDeclaration(statement, code);
                    statements.splice(index, 1, ...replacement);
                    index += replacement.length - 1;
                    continue;
                }
                statement.__virtualize = true;
            }

            preprocessVirtualizedFunctionsInList(statement.body.body, code, needToVirtualize);
            continue;
        }

        switch (statement.type) {
            case "BlockStatement":
                preprocessVirtualizedFunctionsInList(statement.body, code, needToVirtualize);
                break;
            case "IfStatement":
                preprocessVirtualizedFunctionsInNode(statement.consequent, code, needToVirtualize);
                preprocessVirtualizedFunctionsInNode(statement.alternate, code, needToVirtualize);
                break;
            case "ForStatement":
            case "ForInStatement":
            case "ForOfStatement":
            case "WhileStatement":
            case "DoWhileStatement":
            case "LabeledStatement":
                preprocessVirtualizedFunctionsInNode(statement.body, code, needToVirtualize);
                break;
            case "SwitchStatement":
                for (const switchCase of statement.cases) {
                    preprocessVirtualizedFunctionsInList(switchCase.consequent, code, needToVirtualize);
                }
                break;
            case "TryStatement":
                preprocessVirtualizedFunctionsInNode(statement.block, code, needToVirtualize);
                if (statement.handler) {
                    preprocessVirtualizedFunctionsInNode(statement.handler.body, code, needToVirtualize);
                }
                preprocessVirtualizedFunctionsInNode(statement.finalizer, code, needToVirtualize);
                break;
            case "ExportNamedDeclaration":
            case "ExportDefaultDeclaration":
                preprocessVirtualizedFunctionsInNode(statement.declaration, code, needToVirtualize);
                break;
        }
    }
}

function preprocessVirtualizedFunctionsInNode(node, code, needToVirtualize) {
    if (!node) {
        return;
    }

    if (node.type === "BlockStatement") {
        preprocessVirtualizedFunctionsInList(node.body, code, needToVirtualize);
        return;
    }

    if (node.type === "FunctionDeclaration") {
        preprocessVirtualizedFunctionsInList([node], code, needToVirtualize);
    }
}

function createTopLevelHelperName(prefix) {
    return `__jsv_top_${prefix}_${crypto.randomBytes(5).toString("hex")}`;
}

function nodeContainsSyntax(node, visitorMap) {
    let found = false;
    walk.simple(node, Object.fromEntries(Object.keys(visitorMap).map((key) => [key, () => {
        found = true;
    }])));
    return found;
}

function shouldSkipTopLevelVirtualizationExpression(node) {
    if (!node) {
        return true;
    }

    const hasUnsupportedSyntax = nodeContainsSyntax(node, {
        AwaitExpression: true,
        Super: true,
        YieldExpression: true
    });

    if (hasUnsupportedSyntax) {
        return true;
    }

    function isSupportedTopLevelInitializerExpression(expression) {
        if (!expression) {
            return false;
        }

        switch (expression.type) {
            case "Literal":
            case "Identifier":
            case "ThisExpression":
                return true;
            case "UnaryExpression":
                return isSupportedTopLevelInitializerExpression(expression.argument);
            case "BinaryExpression":
            case "LogicalExpression":
                return isSupportedTopLevelInitializerExpression(expression.left) &&
                    isSupportedTopLevelInitializerExpression(expression.right);
            case "ConditionalExpression":
                return isSupportedTopLevelInitializerExpression(expression.test) &&
                    isSupportedTopLevelInitializerExpression(expression.consequent) &&
                    isSupportedTopLevelInitializerExpression(expression.alternate);
            case "MemberExpression":
                return !expression.optional &&
                    isSupportedTopLevelInitializerExpression(expression.object) &&
                    (!expression.computed || isSupportedTopLevelInitializerExpression(expression.property));
            case "TemplateLiteral":
                return expression.expressions.every((part) => isSupportedTopLevelInitializerExpression(part));
            default:
                return false;
        }
    }

    return !isSupportedTopLevelInitializerExpression(node);
}

function createTopLevelHelperCall(name) {
    return {
        type: "CallExpression",
        optional: false,
        callee: {
            type: "MemberExpression",
            object: {
                type: "Identifier",
                name
            },
            property: {
                type: "Identifier",
                name: "call"
            },
            computed: false,
            optional: false
        },
        arguments: [{
            type: "ThisExpression"
        }]
    };
}

function createTopLevelVirtualizedHelper(name, expression) {
    return {
        type: "FunctionDeclaration",
        id: {
            type: "Identifier",
            name
        },
        params: [],
        generator: false,
        async: false,
        expression: false,
        body: {
            type: "BlockStatement",
            body: [{
                type: "ReturnStatement",
                argument: expression
            }]
        },
        __virtualize: true
    };
}

function rewriteTopLevelVariableDeclaration(statement, helpers) {
    let changed = false;

    for (const declarator of statement.declarations) {
        if (!declarator.init || shouldSkipTopLevelVirtualizationExpression(declarator.init)) {
            continue;
        }

        const helperName = createTopLevelHelperName("init");
        helpers.push(createTopLevelVirtualizedHelper(helperName, declarator.init));
        declarator.init = createTopLevelHelperCall(helperName);
        changed = true;
    }

    return changed;
}

function injectAutomaticTopLevelVirtualization(programBody) {
    const rewritten = [];

    for (const statement of programBody) {
        const helpers = [];

        if (statement.type === "VariableDeclaration") {
            rewriteTopLevelVariableDeclaration(statement, helpers);
            rewritten.push(...helpers, statement);
            continue;
        }

        if (statement.type === "ExportNamedDeclaration" && statement.declaration?.type === "VariableDeclaration") {
            rewriteTopLevelVariableDeclaration(statement.declaration, helpers);
            rewritten.push(...helpers, statement);
            continue;
        }

        rewritten.push(statement);
    }

    programBody.splice(0, programBody.length, ...rewritten);
}

function createArgumentScramblingPlan(paramNames) {
    if (paramNames.length === 0) {
        return {
            aliasSetup: "",
            aliasesByParam: {}
        };
    }

    const aliasesByParam = {};
    const declarationOrder = shuffle(Array.from({length: paramNames.length}, (_, index) => index));
    const declarations = [];

    for (const index of declarationOrder) {
        const paramName = paramNames[index];
        const alias = `__jsv_arg_${crypto.randomBytes(4).toString("hex")}`;
        aliasesByParam[paramName] = alias;
        declarations.push(`const ${alias} = ${paramName};`);
    }

    return {
        aliasSetup: declarations.join(""),
        aliasesByParam
    };
}

function createDeadCodeSequence() {
    const registers = Array.from({length: 6}, () => crypto.randomInt(16, 220));
    const [counterRegister, oneRegister, stringRegister, arrayRegister, numberRegister, flagRegister] = registers;
    const baitLabel = `__dead_${crypto.randomBytes(4).toString("hex")}`;
    const baitNumber = crypto.randomInt(256, 65535);

    return [
        new Opcode("LOAD_DWORD", counterRegister, encodeDWORD(0)),
        new Opcode("LOAD_DWORD", oneRegister, encodeDWORD(1)),
        new Opcode("LOAD_STRING", stringRegister, encodeString(baitLabel)),
        new Opcode("SETUP_ARRAY", arrayRegister, encodeDWORD(2)),
        new Opcode("SET_INDEX", arrayRegister, counterRegister, stringRegister),
        new Opcode("ADD", counterRegister, counterRegister, oneRegister),
        new Opcode("LOAD_DWORD", numberRegister, encodeDWORD(baitNumber)),
        new Opcode("SET_INDEX", arrayRegister, counterRegister, numberRegister),
        new Opcode("TEST", flagRegister, numberRegister),
        new Opcode("NOP")
    ];
}

function createMacroPaddingByte() {
    return Buffer.from([crypto.randomInt(0, 256)]);
}

function applyMacroOpcodes(chunk) {
    const fused = [];

    for (let index = 0; index < chunk.code.length; index++) {
        const current = chunk.code[index];
        const next = chunk.code[index + 1];

        if (current?.name === "LOAD_DWORD" && next?.name === "LOAD_DWORD") {
            fused.push(new Opcode(
                "MACRO_LOAD_DWORD_PAIR",
                Buffer.concat([current.data, next.data, createMacroPaddingByte()])
            ));
            index++;
            continue;
        }

        if (
            current?.name === "TEST" &&
            (next?.name === "JUMP_EQ" || next?.name === "JUMP_NOT_EQ") &&
            current.data[0] === next.data[0]
        ) {
            fused.push(new Opcode(
                next.name === "JUMP_EQ" ? "MACRO_TEST_JUMP_EQ" : "MACRO_TEST_JUMP_NOT_EQ",
                Buffer.concat([current.data, next.data, createMacroPaddingByte()])
            ));
            index++;
            continue;
        }

        fused.push(current);
    }

    chunk.code = fused;
}

function injectDeadCode(chunk) {
    const decoySequence = createDeadCodeSequence();
    const decoyLength = decoySequence.reduce((total, opcode) => total + opcode.toBytes().length, 0);

    if (chunk.code.length === 0 || chunk.code[chunk.code.length - 1].name !== "END") {
        chunk.append(new Opcode("JUMP_UNCONDITIONAL", encodeDWORD(5 + decoyLength)));
        decoySequence.forEach((opcode) => chunk.append(opcode));
        chunk.append(new Opcode("END"));
        return;
    }

    decoySequence.forEach((opcode) => chunk.append(opcode));
}

function getJumpEncodingOffsets(opcodeName) {
    switch (opcodeName) {
        case "JUMP_UNCONDITIONAL":
            return [0];
        case "JUMP_EQ":
        case "JUMP_NOT_EQ":
            return [1];
        case "TRY_CATCH_FINALLY":
            return [1, 5];
        case "MACRO_TEST_JUMP_EQ":
        case "MACRO_TEST_JUMP_NOT_EQ":
            return [3];
        default:
            return [];
    }
}

function applyStatefulOpcodeEncoding(chunk, seed) {
    let position = 0;

    for (const opcode of chunk.code) {
        opcode.opcode = Buffer.from([JSVM.encodeStatefulOpcode(opcode.opcode[0], position, seed)]);
        position += opcode.toBytes().length;
    }
}

function applyJumpTargetEncoding(chunk, seed) {
    let position = 0;

    for (const opcode of chunk.code) {
        const offsets = getJumpEncodingOffsets(opcode.name);

        if (offsets.length > 0) {
            opcode.data = Buffer.from(opcode.data);
            for (const offset of offsets) {
                const encoded = JSVM.encodeJumpTargetBytes(opcode.data.slice(offset, offset + 4), position + 1 + offset, seed);
                encoded.copy(opcode.data, offset);
            }
        }

        position += opcode.toBytes().length;
    }
}

function applyPerInstructionEncoding(chunk, seed) {
    let position = 0;

    for (const opcode of chunk.code) {
        if (opcode.data.length > 0) {
            opcode.data = JSVM.encodeInstructionBytes(opcode.data, position, seed);
        }
        position += opcode.toBytes().length;
    }
}

async function transpile(code, options) {
    options = options ?? {};
    options.decoratorsMode = options.decoratorsMode ?? "legacy";
    options.deadCodeInjection = options.deadCodeInjection ?? true;
    options.memoryProtection = options.memoryProtection ?? true;
    options.vmObfuscationTarget = options.vmObfuscationTarget ?? "node";
    options.transpiledObfuscationTarget = options.transpiledObfuscationTarget ?? "node";
    options.fileName = options.fileName ?? crypto.randomBytes(8).toString('hex')
    options.writeOutput = options.writeOutput ?? true;
    options.vmOutputPath = options.vmOutputPath ?? path.join(__dirname, `../output/${options.fileName}.vm.js`);
    options.transpiledOutputPath = options.transpiledOutputPath ?? path.join(__dirname, `../output/${options.fileName}.virtualized.js`);
    options.passes = (options.passes && new Set(options.passes)) ?? new Set([
        "RemoveUnused",
        "ObfuscateVM",
        "ObfuscateTranspiled"
    ]);

    if (!path.isAbsolute(options.vmOutputPath)) options.vmOutputPath = path.join(process.cwd(), options.vmOutputPath);

    const encoding = encodings[crypto.randomInt(0, encodings.length)];
    code = preprocessDecorators(code, options.decoratorsMode);

    const comments = [];

    const ast = acorn.parse(code, {
        ecmaVersion: "latest",
        sourceType: "module",
        locations: true,
        onComment: comments,
        ranges: true,
    });

    injectAutomaticTopLevelVirtualization(ast.body);

    const vmAST = acorn.parse(vmDist, {ecmaVersion: "latest", sourceType: "module"})

    let vmRelativePath = path.relative(path.dirname(options.transpiledOutputPath), options.vmOutputPath)
    if (!vmRelativePath.startsWith(".")) {
        vmRelativePath = `./${vmRelativePath}`
    }
    const requireInject = requireTemplate.replace("%VM_PATH%", vmRelativePath)

    ast.body.unshift(acorn.parse(requireInject, {ecmaVersion: "latest", sourceType: "module"}).body[0])

    function needToVirtualize(node) {
        if (!node || !node.loc || !node.loc.start) {
            return false;
        }
        return comments.some((comment) => {
            return (
                comment.type === "Line" &&
                comment.value.trim() === "@virtualize" &&
                comment.loc.end.line === node.loc.start.line - 1
            );
        });
    }

    preprocessVirtualizedFunctionsInList(ast.body, code, needToVirtualize);

    function analyzeScope(ast, functionNode) {
        const scopeManager = eslintScope.analyze(ast, {ecmaVersion: 2021, sourceType: "module"});
        const functionScope = scopeManager.acquire(functionNode);
        if (!functionScope) {
            throw new Error("Failed to acquire scope for function");
        }
        const dependencies = new Set();
        functionScope.through.forEach((reference) => {
            dependencies.add(reference.identifier.name);
        });
        return Array.from(dependencies)
    }

    const chunks = []
    const rewriteQueue = []

    function virtualizeFunction(node) {
        log(new LogData(`Virtualizing Function "${node.id.name}"`, 'info', false));
        const dependencies = analyzeScope(ast, node);
        const integrityKey = crypto.randomBytes(16).toString("hex");
        const bytecodeKeyId = `JSVK_${crypto.randomBytes(6).toString("hex")}`;
        const bytecodeEncryptionKey = crypto.randomBytes(24).toString("base64");
        const memoryProtectionKey = crypto.randomBytes(16).toString("hex");
        const antiDebugKey = crypto.randomBytes(16).toString("hex");
        const usesArguments = usesIdentifier(node.body, "arguments");
        const usesThis = (() => {
            let found = false
            walk.simple(node.body, {
                ThisExpression() {
                    found = true
                }
            })
            return found
        })()
        const functionBody = desugarStatementList(node.body.body);
        walk.simple({type: "Program", body: functionBody}, {
            Identifier(identifier) {
                if (identifier.name === "Object" && !dependencies.includes("Object")) {
                    dependencies.push("Object");
                }
                if (identifier.name === "WeakMap" && !dependencies.includes("WeakMap")) {
                    dependencies.push("WeakMap");
                }
            }
        });
        const regToDep = {}

        const generator = new FunctionBytecodeGenerator(functionBody);

        for (const dependency of dependencies) {
            const register = generator.randomRegister()
            regToDep[register] = dependency
            generator.declareVariable(dependency, register)
        }

        if (usesThis) {
            const register = generator.randomRegister()
            regToDep[register] = "this"
            generator.declareVariable("this", register)
        }

        if (usesArguments && !node.params.some((param) => param.type === "Identifier" && param.name === "arguments")) {
            const register = generator.randomRegister()
            regToDep[register] = "arguments"
            generator.declareVariable("arguments", register)
        }

        const params = []

        for (const arg of node.params) {
            const register = generator.randomRegister()
            switch (arg.type) {
                case "AssignmentPattern":
                    // unnecessary because we only replace the function body
                    // log(new LogData(`Resolving nullish parameter ${arg.left.name} = ${arg.right.value}`, 'info', false));
                    generator.declareVariable(arg.left.name, register)
                    // generator.resolveExpression(arg)
                    regToDep[register] = arg.left.name
                    params.push(arg.left.name)
                    break
                case "Identifier":
                    // log(new LogData(`Resolving parameter ${arg.name}`, 'info', false));
                    generator.declareVariable(arg.name, register)
                    regToDep[register] = arg.name
                    params.push(arg.name)
                    break
                case "RestElement":
                    // log(new LogData(`Resolving rest parameter ${arg.argument.name}`, 'info', false));
                    generator.declareVariable(arg.argument.name, register)
                    regToDep[register] = arg.argument.name
                    params.push(arg.argument.name)
                    break
                default: {
                    throw new Error(`Unsupported argument type: ${arg.type}`)
                }
            }
        }

        const {aliasSetup, aliasesByParam} = createArgumentScramblingPlan(params);
        Object.keys(regToDep).forEach((register) => {
            if (aliasesByParam[regToDep[register]]) {
                regToDep[register] = aliasesByParam[regToDep[register]];
            }
        });

        generator.generate();
        applyMacroOpcodes(generator.chunk);
        if (options.deadCodeInjection) {
            injectDeadCode(generator.chunk);
        }
        chunks.push(generator.chunk)

        const virtualizedFunction = functionWrapperTemplate
            .replace("%FN_PREFIX%", node.async ? "async " : "")
            .replace("%FUNCTION_NAME%", node.id.name)
            .replace("%ARGS%", params.join(","))
            .replace("%ARG_SCRAMBLE_SETUP%", aliasSetup)
            .replace("%MEMORY_PROTECTION_SETUP%", options.memoryProtection ? `VM.enableMemoryProtection('${memoryProtectionKey}');` : "")
            .replace("%ENCODING%", encoding)
            .replace("%BYTECODE_INTEGRITY_KEY%", integrityKey)
            .replace("%ANTI_DEBUG_SETUP%", `VM.enableAntiDebug('${antiDebugKey}');`)
            .replace("%DEPENDENCIES%", JSON.stringify(regToDep).replace(/"/g, ""))
            .replace("%OUTPUT_REGISTER%", generator.outputRegister.toString())
            .replace("%RUNCMD%", node.async ? "await VM.runAsync()" : "VM.run()");

        const dependentTemploads = []
        Object.keys(generator.available).forEach((k) => {
            if (!generator.available[k]) {
                dependentTemploads.push(k)
            }
        })
        if (dependentTemploads.length > 0) {
            log(new LogData(`Warning: Non-freed tempload(s) detected: ${dependentTemploads.join(", ")}`, 'warn', false));
        }
        log(new LogData(`Successfully Virtualized Function "${node.id.name}"`, 'success', false));
        log(`Dependencies: ${JSON.stringify(dependencies)}`);
        rewriteQueue.push({
            result: virtualizedFunction,
            node,
            chunk: generator.chunk,
            integrityKey,
            bytecodeKeyId,
            bytecodeEncryptionKey
        })
    }

    walk.simple(ast, {
        FunctionDeclaration(node) {
            if (node.__virtualize) {
                virtualizeFunction(node);
            }
        },
    });

    if (options.passes.has("RemoveUnused")) {
        obfuscateOpcodes(chunks, vmAST)
    }

    rewriteQueue.forEach(({result, node, chunk, integrityKey, bytecodeKeyId, bytecodeEncryptionKey}) => {
        const opcodeSeed = JSVM.deriveOpcodeStateSeed(integrityKey);
        const jumpSeed = JSVM.deriveJumpTargetSeed(integrityKey);
        const instructionSeed = JSVM.deriveInstructionByteSeed(integrityKey);
        applyStatefulOpcodeEncoding(chunk, opcodeSeed);
        applyJumpTargetEncoding(chunk, jumpSeed);
        applyPerInstructionEncoding(chunk, instructionSeed);
        const bytecode = zlib.deflateSync(Buffer.from(chunk.toBytes())).toString(encoding);
        const integritySalt = crypto.randomBytes(8).toString("hex");
        const protectedBytecode = JSVM.createEncryptedBytecodeEnvelope(bytecode, encoding, integrityKey, bytecodeKeyId, bytecodeEncryptionKey, integritySalt, "IJS");
        result = result.replace("%BYTECODE%", protectedBytecode);
        node.body.body = acorn.parse(result, {ecmaVersion: "latest", sourceType: "module"}).body[0].body.body
    })

    let accompanyingVM = escodegen.generate(vmAST);
    const bytecodeKeyRegistrations = rewriteQueue
        .map(({bytecodeKeyId, bytecodeEncryptionKey}) => `JSVM.registerBytecodeKey('${bytecodeKeyId}', '${bytecodeEncryptionKey}');`)
        .join("\n");
    if (bytecodeKeyRegistrations.length > 0) {
        accompanyingVM = `${accompanyingVM}\n${bytecodeKeyRegistrations}\n`;
    }
    let transpiledResult = escodegen.generate(ast);

    if (options.passes.has("ObfuscateVM")) {
        accompanyingVM = await obfuscateCode(accompanyingVM, {
            target: options.vmObfuscationTarget
        })
    }

    if (options.passes.has("ObfuscateTranspiled")) {
        transpiledResult = await obfuscateCode(transpiledResult, {
            target: options.transpiledObfuscationTarget
        })
    }

    if (options.writeOutput) {
        fs.writeFileSync(options.vmOutputPath, accompanyingVM);
        fs.writeFileSync(options.transpiledOutputPath, transpiledResult);
    }

    return {
        vm: accompanyingVM,
        transpiled: transpiledResult,
        vmOutputPath: options.writeOutput ? options.vmOutputPath : null,
        transpiledOutputPath: options.writeOutput ? options.transpiledOutputPath : null
    }
}

module.exports = {
    transpile
}
