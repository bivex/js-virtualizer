/**
 * Copyright (c) 2026 Bivex
 *
 * Author: Bivex
 * Available for contact via email: support@b-b.top
 * For up-to-date contact information:
 * https://github.com/bivex
 *
 * Created: 2026-03-26 18:53
 * Last Updated: 2026-03-26 18:53
 *
 * Licensed under the MIT License.
 * Commercial licensing available upon request.
 */

const acorn = require("acorn");
const escodegen = require("escodegen");

function parseStatements(code) {
    return acorn.parse(code, {
        ecmaVersion: "latest",
        sourceType: "module"
    }).body;
}

function getPropertyAccessorCode(key, computed) {
    if (computed) {
        return `[${escodegen.generate(key)}]`;
    }

    if (key.type === "Identifier") {
        return `.${key.name}`;
    }

    return `[${JSON.stringify(key.value)}]`;
}

function classDeclarationToStatements(node) {
    if (!node.id) {
        throw new Error("Anonymous class declarations are not supported");
    }
    if (node.superClass) {
        throw new Error("Class inheritance is not supported in virtualized functions");
    }

    const className = node.id.name;
    const constructorMethod = node.body.body.find((method) => method.kind === "constructor");

    const constructorParams = constructorMethod
        ? constructorMethod.value.params.map((param) => escodegen.generate(param)).join(", ")
        : "";
    const constructorBody = constructorMethod
        ? constructorMethod.value.body.body.map((statement) => escodegen.generate(statement)).join("\n")
        : "";

    let code = `function ${className}(${constructorParams}) {\n${constructorBody}\n}\n`;

    for (const method of node.body.body) {
        if (method.kind === "constructor") continue;
        if (method.type !== "MethodDefinition") {
            throw new Error(`Unsupported class element: ${method.type}`);
        }
        if (method.kind !== "method") {
            throw new Error(`Unsupported class method kind: ${method.kind}`);
        }
        if (method.key.type === "PrivateIdentifier") {
            throw new Error("Private class fields and methods are not supported");
        }

        const target = method.static
            ? `${className}${getPropertyAccessorCode(method.key, method.computed)}`
            : `${className}.prototype${getPropertyAccessorCode(method.key, method.computed)}`;
        const params = method.value.params.map((param) => escodegen.generate(param)).join(", ");
        const body = method.value.body.body.map((statement) => escodegen.generate(statement)).join("\n");

        code += `${target} = function(${params}) {\n${body}\n};\n`;
    }

    return parseStatements(code);
}

function desugarStatement(statement) {
    if (!statement) return statement;

    switch (statement.type) {
        case "BlockStatement": {
            statement.body = desugarStatementList(statement.body);
            break;
        }
        case "IfStatement": {
            statement.consequent = desugarStatement(statement.consequent);
            if (statement.alternate) {
                statement.alternate = desugarStatement(statement.alternate);
            }
            break;
        }
        case "ForStatement":
        case "ForInStatement":
        case "ForOfStatement":
        case "WhileStatement":
        case "DoWhileStatement":
        case "LabeledStatement": {
            statement.body = desugarStatement(statement.body);
            break;
        }
        case "TryStatement": {
            statement.block = desugarStatement(statement.block);
            if (statement.handler) {
                statement.handler.body = desugarStatement(statement.handler.body);
            }
            if (statement.finalizer) {
                statement.finalizer = desugarStatement(statement.finalizer);
            }
            break;
        }
        case "SwitchStatement": {
            statement.cases.forEach((switchCase) => {
                switchCase.consequent = desugarStatementList(switchCase.consequent);
            });
            break;
        }
        case "FunctionDeclaration":
        case "FunctionExpression":
        case "ArrowFunctionExpression": {
            if (statement.body && statement.body.type === "BlockStatement") {
                statement.body.body = desugarStatementList(statement.body.body);
            }
            break;
        }
    }

    return statement;
}

function desugarStatementList(statements) {
    const transformed = [];

    for (const statement of statements) {
        if (statement.type === "ClassDeclaration") {
            transformed.push(...classDeclarationToStatements(statement));
            continue;
        }
        transformed.push(desugarStatement(statement));
    }

    return transformed;
}

module.exports = {
    desugarStatementList
};
