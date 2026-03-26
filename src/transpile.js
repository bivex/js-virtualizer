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
const eslintScope = require("eslint-scope");
const {readFileSync, writeFileSync} = require("node:fs");
const path = require("node:path");
const functionWrapperTemplate = readFileSync(path.join(__dirname, "./templates/functionWrapper.template"), "utf-8");
const requireTemplate = readFileSync(path.join(__dirname, "./templates/requireTemplate.template"), "utf-8");
const crypto = require("crypto");
const {FunctionBytecodeGenerator} = require("./utils/BytecodeGenerator");
const escodegen = require("escodegen");
const {log, LogData} = require("./utils/log");
const zlib = require("node:zlib");
const fs = require("node:fs");
const obfuscateCode = require("./postTranspilation/obfuscateCode");
const obfuscateOpcodes = require("./postTranspilation/obfuscateOpcodes");
const {desugarStatementList} = require("./utils/desugar");

const vmDist = fs.readFileSync(path.join(__dirname, './vm_dist.js'), 'utf-8');
const encodings = ['base64']

if (!fs.existsSync(path.join(__dirname, '../output'))) fs.mkdirSync(path.join(__dirname, '../output'))

function preprocessDecorators(code) {
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
        plugins: [[decoratorsPlugin, {legacy: true}]]
    });

    if (!transformed || !transformed.code) {
        throw new Error("Failed to preprocess decorators");
    }

    return transformed.code;
}

async function transpile(code, options) {
    options = options ?? {};
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
    code = preprocessDecorators(code);

    const comments = [];

    const ast = acorn.parse(code, {
        ecmaVersion: "latest",
        sourceType: "module",
        locations: true,
        onComment: comments,
        ranges: true,
    });

    const vmAST = acorn.parse(vmDist, {ecmaVersion: "latest", sourceType: "module"})

    let vmRelativePath = path.relative(path.dirname(options.transpiledOutputPath), options.vmOutputPath)
    if (!vmRelativePath.startsWith(".")) {
        vmRelativePath = `./${vmRelativePath}`
    }
    const requireInject = requireTemplate.replace("%VM_PATH%", vmRelativePath)

    ast.body.unshift(acorn.parse(requireInject, {ecmaVersion: "latest", sourceType: "module"}).body[0])

    function needToVirtualize(node) {
        return comments.some((comment) => {
            return (
                comment.type === "Line" &&
                comment.value.trim() === "@virtualize" &&
                comment.loc.end.line === node.loc.start.line - 1
            );
        });
    }

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

        generator.generate();
        chunks.push(generator.chunk)

        const virtualizedFunction = functionWrapperTemplate
            .replace("%FN_PREFIX%", node.async ? "async " : "")
            .replace("%FUNCTION_NAME%", node.id.name)
            .replace("%ARGS%", params.join(","))
            .replace("%ENCODING%", encoding)
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
            chunk: generator.chunk
        })
    }

    walk.simple(ast, {
        FunctionDeclaration(node) {
            if (needToVirtualize(node)) {
                virtualizeFunction(node);
            }
        },
    });

    if (options.passes.has("RemoveUnused")) {
        obfuscateOpcodes(chunks, vmAST)
    }

    rewriteQueue.forEach(({result, node, chunk}) => {
        const bytecode = zlib.deflateSync(Buffer.from(chunk.toBytes())).toString(encoding);
        result = result.replace("%BYTECODE%", bytecode);
        node.body.body = acorn.parse(result, {ecmaVersion: "latest", sourceType: "module"}).body[0].body.body
    })

    let accompanyingVM = escodegen.generate(vmAST);
    let transpiledResult = escodegen.generate(ast);

    if (options.passes.has("ObfuscateVM")) {
        accompanyingVM = await obfuscateCode(accompanyingVM)
    }

    if (options.passes.has("ObfuscateTranspiled")) {
        transpiledResult = await obfuscateCode(transpiledResult)
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
