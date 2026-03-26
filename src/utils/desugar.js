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

function parseExpression(code) {
    return acorn.parse(`(${code})`, {
        ecmaVersion: "latest",
        sourceType: "module"
    }).body[0].expression;
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

function sanitizeIdentifier(value) {
    return String(value).replace(/[^a-zA-Z0-9_$]/g, "_");
}

function getPrivateStorageName(className, privateName, isStatic) {
    return `__${sanitizeIdentifier(className)}_${isStatic ? "static_" : ""}private_${sanitizeIdentifier(privateName)}`;
}

function getPrivateFieldInfo(property, privateFields) {
    if (!property || property.type !== "PrivateIdentifier") {
        return null;
    }

    const info = privateFields.get(property.name);
    if (!info) {
        throw new Error(`Unknown private field: #${property.name}`);
    }

    return info;
}

function buildPrivateGetCode(info, objectCode) {
    switch (info.kind) {
        case "field":
        case "method":
            return `${info.storageName}.get(${objectCode})`;
        case "accessor":
            return `${info.storageName}.get(${objectCode}).get.call(${objectCode})`;
        default:
            throw new Error(`Unsupported private member kind: ${info.kind}`);
    }
}

function buildPrivateSetCode(info, objectCode, valueCode) {
    switch (info.kind) {
        case "field":
            return `${info.storageName}.set(${objectCode}, ${valueCode});`;
        case "accessor":
            return `${info.storageName}.get(${objectCode}).set.call(${objectCode}, ${valueCode});`;
        default:
            throw new Error(`Private ${info.kind} cannot be assigned`);
    }
}

function buildPrivateFieldReadExpression(memberExpression, privateFields) {
    const info = getPrivateFieldInfo(memberExpression.property, privateFields);
    if (!info) {
        return null;
    }

    const objectCode = escodegen.generate(transformPrivateExpression(memberExpression.object, privateFields));
    return parseExpression(buildPrivateGetCode(info, objectCode));
}

function buildPrivateFieldAssignmentExpression(expression, privateFields) {
    const info = getPrivateFieldInfo(expression.left.property, privateFields);
    if (!info) {
        return null;
    }

    const objectCode = escodegen.generate(transformPrivateExpression(expression.left.object, privateFields));
    const valueCode = escodegen.generate(transformPrivateExpression(expression.right, privateFields));

    if (expression.operator === "=") {
        return parseExpression(`(() => {
            const __privateObject = ${objectCode};
            const __privateValue = ${valueCode};
            ${buildPrivateSetCode(info, "__privateObject", "__privateValue")}
            return __privateValue;
        })()`);
    }

    const operator = expression.operator.slice(0, -1);

    return parseExpression(`(() => {
        const __privateObject = ${objectCode};
        const __privateValue = ${buildPrivateGetCode(info, "__privateObject")} ${operator} ${valueCode};
        ${buildPrivateSetCode(info, "__privateObject", "__privateValue")}
        return __privateValue;
    })()`);
}

function buildPrivateFieldUpdateExpression(expression, privateFields) {
    const info = getPrivateFieldInfo(expression.argument.property, privateFields);
    if (!info) {
        return null;
    }

    const objectCode = escodegen.generate(transformPrivateExpression(expression.argument.object, privateFields));

    return parseExpression(`(() => {
        const __privateObject = ${objectCode};
        const __privateCurrent = ${buildPrivateGetCode(info, "__privateObject")};
        const __privateNext = __privateCurrent ${expression.operator === "++" ? "+" : "-"} 1;
        ${buildPrivateSetCode(info, "__privateObject", "__privateNext")}
        return ${expression.prefix ? "__privateNext" : "__privateCurrent"};
    })()`);
}

function transformPrivateExpression(expression, privateFields) {
    if (!expression) return expression;

    switch (expression.type) {
        case "AssignmentExpression": {
            if (expression.left.type === "MemberExpression" && expression.left.property.type === "PrivateIdentifier") {
                return buildPrivateFieldAssignmentExpression(expression, privateFields);
            }
            expression.left = transformPrivateExpression(expression.left, privateFields);
            expression.right = transformPrivateExpression(expression.right, privateFields);
            return expression;
        }
        case "BinaryExpression": {
            if (expression.operator === "in" && expression.left.type === "PrivateIdentifier") {
                const info = getPrivateFieldInfo(expression.left, privateFields);
                const objectCode = escodegen.generate(transformPrivateExpression(expression.right, privateFields));
                return parseExpression(`${info.storageName}.has(${objectCode})`);
            }
            expression.left = transformPrivateExpression(expression.left, privateFields);
            expression.right = transformPrivateExpression(expression.right, privateFields);
            return expression;
        }
        case "LogicalExpression":
            expression.left = transformPrivateExpression(expression.left, privateFields);
            expression.right = transformPrivateExpression(expression.right, privateFields);
            return expression;
        case "UnaryExpression":
            expression.argument = transformPrivateExpression(expression.argument, privateFields);
            return expression;
        case "UpdateExpression": {
            if (expression.argument.type === "MemberExpression" && expression.argument.property.type === "PrivateIdentifier") {
                return buildPrivateFieldUpdateExpression(expression, privateFields);
            }
            expression.argument = transformPrivateExpression(expression.argument, privateFields);
            return expression;
        }
        case "ConditionalExpression":
            expression.test = transformPrivateExpression(expression.test, privateFields);
            expression.consequent = transformPrivateExpression(expression.consequent, privateFields);
            expression.alternate = transformPrivateExpression(expression.alternate, privateFields);
            return expression;
        case "CallExpression":
        case "NewExpression":
            expression.callee = transformPrivateExpression(expression.callee, privateFields);
            expression.arguments = expression.arguments.map((argument) => transformPrivateExpression(argument, privateFields));
            return expression;
        case "MemberExpression": {
            if (expression.property.type === "PrivateIdentifier") {
                return buildPrivateFieldReadExpression(expression, privateFields);
            }
            expression.object = transformPrivateExpression(expression.object, privateFields);
            expression.property = transformPrivateExpression(expression.property, privateFields);
            return expression;
        }
        case "ArrayExpression":
            expression.elements = expression.elements.map((element) => transformPrivateExpression(element, privateFields));
            return expression;
        case "ObjectExpression":
            expression.properties.forEach((property) => {
                if (property.type === "Property") {
                    property.value = transformPrivateExpression(property.value, privateFields);
                    if (property.computed) {
                        property.key = transformPrivateExpression(property.key, privateFields);
                    }
                }
            });
            return expression;
        case "SequenceExpression":
            expression.expressions = expression.expressions.map((child) => transformPrivateExpression(child, privateFields));
            return expression;
        case "TemplateLiteral":
            expression.expressions = expression.expressions.map((child) => transformPrivateExpression(child, privateFields));
            return expression;
        case "AwaitExpression":
        case "SpreadElement":
            expression.argument = transformPrivateExpression(expression.argument, privateFields);
            return expression;
        default:
            return expression;
    }
}

function transformPrivateStatement(statement, privateFields) {
    if (!statement) return statement;

    switch (statement.type) {
        case "ExpressionStatement":
            statement.expression = transformPrivateExpression(statement.expression, privateFields);
            return statement;
        case "ReturnStatement":
        case "ThrowStatement":
            statement.argument = transformPrivateExpression(statement.argument, privateFields);
            return statement;
        case "VariableDeclaration":
            statement.declarations.forEach((declaration) => {
                declaration.init = transformPrivateExpression(declaration.init, privateFields);
            });
            return statement;
        case "IfStatement":
            statement.test = transformPrivateExpression(statement.test, privateFields);
            statement.consequent = transformPrivateStatement(statement.consequent, privateFields);
            if (statement.alternate) {
                statement.alternate = transformPrivateStatement(statement.alternate, privateFields);
            }
            return statement;
        case "BlockStatement":
            statement.body = statement.body.map((child) => transformPrivateStatement(child, privateFields));
            return statement;
        case "ForStatement":
            if (statement.init && statement.init.type !== "VariableDeclaration") {
                statement.init = transformPrivateExpression(statement.init, privateFields);
            }
            if (statement.init && statement.init.type === "VariableDeclaration") {
                statement.init = transformPrivateStatement(statement.init, privateFields);
            }
            if (statement.test) statement.test = transformPrivateExpression(statement.test, privateFields);
            if (statement.update) statement.update = transformPrivateExpression(statement.update, privateFields);
            statement.body = transformPrivateStatement(statement.body, privateFields);
            return statement;
        case "ForInStatement":
        case "ForOfStatement":
            if (statement.left && statement.left.type !== "VariableDeclaration") {
                statement.left = transformPrivateExpression(statement.left, privateFields);
            }
            if (statement.left && statement.left.type === "VariableDeclaration") {
                statement.left = transformPrivateStatement(statement.left, privateFields);
            }
            statement.right = transformPrivateExpression(statement.right, privateFields);
            statement.body = transformPrivateStatement(statement.body, privateFields);
            return statement;
        case "WhileStatement":
        case "DoWhileStatement":
            if (statement.test) statement.test = transformPrivateExpression(statement.test, privateFields);
            statement.body = transformPrivateStatement(statement.body, privateFields);
            return statement;
        case "SwitchStatement":
            statement.discriminant = transformPrivateExpression(statement.discriminant, privateFields);
            statement.cases.forEach((switchCase) => {
                switchCase.test = transformPrivateExpression(switchCase.test, privateFields);
                switchCase.consequent = switchCase.consequent.map((child) => transformPrivateStatement(child, privateFields));
            });
            return statement;
        case "TryStatement":
            statement.block = transformPrivateStatement(statement.block, privateFields);
            if (statement.handler) {
                statement.handler.body = transformPrivateStatement(statement.handler.body, privateFields);
            }
            if (statement.finalizer) {
                statement.finalizer = transformPrivateStatement(statement.finalizer, privateFields);
            }
            return statement;
        default:
            return statement;
    }
}

function transformSuperExpression(expression, options) {
    if (!expression) return expression;
    options = options ?? {};

    const superTargetBase = options.isStatic
        ? options.superClassCode
        : `${options.superClassCode}.prototype`;

    switch (expression.type) {
        case "CallExpression": {
            if (expression.callee.type === "Super") {
                if (!options.inConstructor) {
                    throw new Error("Direct super() calls are only supported in constructors");
                }
                const args = expression.arguments.map((argument) => escodegen.generate(transformSuperExpression(argument, options))).join(", ");
                return parseExpression(`${options.superClassCode}.call(this${args ? `, ${args}` : ""})`);
            }

            if (expression.callee.type === "MemberExpression" && expression.callee.object.type === "Super") {
                const propertyAccessor = getPropertyAccessorCode(expression.callee.property, expression.callee.computed);
                const args = expression.arguments.map((argument) => escodegen.generate(transformSuperExpression(argument, options))).join(", ");
                return parseExpression(`${superTargetBase}${propertyAccessor}.call(this${args ? `, ${args}` : ""})`);
            }

            expression.callee = transformSuperExpression(expression.callee, options);
            expression.arguments = expression.arguments.map((argument) => transformSuperExpression(argument, options));
            return expression;
        }
        case "MemberExpression": {
            if (expression.object.type === "Super") {
                const propertyAccessor = getPropertyAccessorCode(expression.property, expression.computed);
                return parseExpression(`${superTargetBase}${propertyAccessor}`);
            }
            expression.object = transformSuperExpression(expression.object, options);
            expression.property = transformSuperExpression(expression.property, options);
            return expression;
        }
        case "AssignmentExpression":
            expression.left = transformSuperExpression(expression.left, options);
            expression.right = transformSuperExpression(expression.right, options);
            return expression;
        case "BinaryExpression":
        case "LogicalExpression":
            expression.left = transformSuperExpression(expression.left, options);
            expression.right = transformSuperExpression(expression.right, options);
            return expression;
        case "UnaryExpression":
        case "UpdateExpression":
            expression.argument = transformSuperExpression(expression.argument, options);
            return expression;
        case "ConditionalExpression":
            expression.test = transformSuperExpression(expression.test, options);
            expression.consequent = transformSuperExpression(expression.consequent, options);
            expression.alternate = transformSuperExpression(expression.alternate, options);
            return expression;
        case "ArrayExpression":
            expression.elements = expression.elements.map((element) => transformSuperExpression(element, options));
            return expression;
        case "ObjectExpression":
            expression.properties.forEach((property) => {
                if (property.type === "Property") {
                    if (property.computed) {
                        property.key = transformSuperExpression(property.key, options);
                    }
                    property.value = transformSuperExpression(property.value, options);
                }
            });
            return expression;
        case "SequenceExpression":
            expression.expressions = expression.expressions.map((child) => transformSuperExpression(child, options));
            return expression;
        case "TemplateLiteral":
            expression.expressions = expression.expressions.map((child) => transformSuperExpression(child, options));
            return expression;
        case "AwaitExpression":
        case "SpreadElement":
            expression.argument = transformSuperExpression(expression.argument, options);
            return expression;
        case "FunctionExpression":
        case "ArrowFunctionExpression":
            return expression;
        default:
            return expression;
    }
}

function transformSuperStatement(statement, options) {
    if (!statement) return statement;

    switch (statement.type) {
        case "ExpressionStatement":
            statement.expression = transformSuperExpression(statement.expression, options);
            return statement;
        case "ReturnStatement":
        case "ThrowStatement":
            statement.argument = transformSuperExpression(statement.argument, options);
            return statement;
        case "VariableDeclaration":
            statement.declarations.forEach((declaration) => {
                declaration.init = transformSuperExpression(declaration.init, options);
            });
            return statement;
        case "IfStatement":
            statement.test = transformSuperExpression(statement.test, options);
            statement.consequent = transformSuperStatement(statement.consequent, options);
            if (statement.alternate) {
                statement.alternate = transformSuperStatement(statement.alternate, options);
            }
            return statement;
        case "BlockStatement":
            statement.body = statement.body.map((child) => transformSuperStatement(child, options));
            return statement;
        case "ForStatement":
            if (statement.init && statement.init.type !== "VariableDeclaration") {
                statement.init = transformSuperExpression(statement.init, options);
            }
            if (statement.init && statement.init.type === "VariableDeclaration") {
                statement.init = transformSuperStatement(statement.init, options);
            }
            if (statement.test) statement.test = transformSuperExpression(statement.test, options);
            if (statement.update) statement.update = transformSuperExpression(statement.update, options);
            statement.body = transformSuperStatement(statement.body, options);
            return statement;
        case "ForInStatement":
        case "ForOfStatement":
            if (statement.left && statement.left.type !== "VariableDeclaration") {
                statement.left = transformSuperExpression(statement.left, options);
            }
            if (statement.left && statement.left.type === "VariableDeclaration") {
                statement.left = transformSuperStatement(statement.left, options);
            }
            statement.right = transformSuperExpression(statement.right, options);
            statement.body = transformSuperStatement(statement.body, options);
            return statement;
        case "WhileStatement":
        case "DoWhileStatement":
            if (statement.test) statement.test = transformSuperExpression(statement.test, options);
            statement.body = transformSuperStatement(statement.body, options);
            return statement;
        case "SwitchStatement":
            statement.discriminant = transformSuperExpression(statement.discriminant, options);
            statement.cases.forEach((switchCase) => {
                switchCase.test = transformSuperExpression(switchCase.test, options);
                switchCase.consequent = switchCase.consequent.map((child) => transformSuperStatement(child, options));
            });
            return statement;
        case "TryStatement":
            statement.block = transformSuperStatement(statement.block, options);
            if (statement.handler) {
                statement.handler.body = transformSuperStatement(statement.handler.body, options);
            }
            if (statement.finalizer) {
                statement.finalizer = transformSuperStatement(statement.finalizer, options);
            }
            return statement;
        default:
            return statement;
    }
}

function buildFieldInitializationCode(field, targetCode, privateFields) {
    const valueCode = field.value
        ? escodegen.generate(transformPrivateExpression(desugarExpression(field.value), privateFields))
        : "undefined";

    if (field.key.type === "PrivateIdentifier") {
        const info = getPrivateFieldInfo(field.key, privateFields);
        return `${info.storageName}.set(${targetCode}, ${valueCode});`;
    }

    const accessor = getPropertyAccessorCode(field.key, field.computed);
    return `${targetCode}${accessor} = ${valueCode};`;
}

function buildPrivateMethodValueCode(method, privateFields, options) {
    const params = method.value.params.map((param) => escodegen.generate(param)).join(", ");
    const body = method.value.body.body
        .map((statement) =>
            escodegen.generate(
                transformSuperStatement(
                    transformPrivateStatement(desugarStatement(statement), privateFields),
                    options
                )
            )
        )
        .join("\n");

    return `function(${params}) {\n${body}\n}`;
}

function buildPrivateAccessorValueCode(info, privateFields, options) {
    const descriptorParts = [];

    if (info.get) {
        descriptorParts.push(`get: ${buildPrivateMethodValueCode(info.get, privateFields, options)}`);
    }

    if (info.set) {
        descriptorParts.push(`set: ${buildPrivateMethodValueCode(info.set, privateFields, options)}`);
    }

    return `{${descriptorParts.join(", ")}}`;
}

function buildPrivateMemberInitializationCode(info, targetCode, privateFields, options) {
    let valueCode;

    if (info.kind === "field") {
        valueCode = info.value
            ? escodegen.generate(transformPrivateExpression(desugarExpression(info.value), privateFields))
            : "undefined";
    } else if (info.kind === "method") {
        valueCode = buildPrivateMethodValueCode(info.method, privateFields, options);
    } else if (info.kind === "accessor") {
        valueCode = buildPrivateAccessorValueCode(info, privateFields, options);
    } else {
        throw new Error(`Unsupported private member kind: ${info.kind}`);
    }

    return `${info.storageName}.set(${targetCode}, ${valueCode});`;
}

function buildClassBodyCode(node, className) {
    const superClassCode = node.superClass ? escodegen.generate(desugarExpression(node.superClass)) : null;

    const constructorMethod = node.body.body.find((method) => method.kind === "constructor");
    const instanceFields = node.body.body.filter((entry) => entry.type === "PropertyDefinition" && !entry.static);
    const staticFields = node.body.body.filter((entry) => entry.type === "PropertyDefinition" && entry.static);
    const privateFields = new Map();

    for (const entry of node.body.body) {
        if (!entry.key || entry.key.type !== "PrivateIdentifier") {
            continue;
        }

        if (!privateFields.has(entry.key.name)) {
            privateFields.set(entry.key.name, {
                storageName: getPrivateStorageName(className, entry.key.name, entry.static),
                static: entry.static,
                kind: null,
                value: null,
                method: null,
                get: null,
                set: null
            });
        }

        const info = privateFields.get(entry.key.name);

        if (info.static !== entry.static) {
            throw new Error("Mixed static and instance private members with the same name are not supported");
        }

        if (entry.type === "PropertyDefinition") {
            info.kind = "field";
            info.value = entry.value;
            continue;
        }

        if (entry.type !== "MethodDefinition") {
            throw new Error(`Unsupported private class element: ${entry.type}`);
        }

        if (entry.kind === "method") {
            info.kind = "method";
            info.method = entry;
            continue;
        }

        if (entry.kind === "get" || entry.kind === "set") {
            info.kind = "accessor";
            info[entry.kind] = entry;
            continue;
        }

        throw new Error(`Unsupported private class method kind: ${entry.kind}`);
    }

    let constructorParams;
    let constructorStatements;

    if (constructorMethod) {
        constructorParams = constructorMethod.value.params.map((param) => escodegen.generate(param)).join(", ");
        constructorStatements = constructorMethod.value.body.body.map((statement) =>
            transformSuperStatement(
                transformPrivateStatement(desugarStatement(statement), privateFields),
                {
                    superClassCode,
                    isStatic: false,
                    inConstructor: true
                }
            )
        );
    } else if (superClassCode) {
        constructorParams = "...args";
        constructorStatements = [parseStatements(`${superClassCode}.apply(this, args);`)[0]];
    } else {
        constructorParams = "";
        constructorStatements = [];
    }

    const fieldStatements = instanceFields
        .filter((field) => field.key.type !== "PrivateIdentifier")
        .map((field) => parseStatements(buildFieldInitializationCode(field, "this", privateFields))[0]);
    const privateInstanceStatements = Array.from(privateFields.values())
        .filter((info) => !info.static)
        .map((info) =>
            parseStatements(buildPrivateMemberInitializationCode(info, "this", privateFields, {
                superClassCode,
                isStatic: false,
                inConstructor: false
            }))[0]
        );
    if (superClassCode) {
        constructorStatements = [
            ...(constructorStatements.length ? [constructorStatements[0]] : []),
            ...fieldStatements,
            ...privateInstanceStatements,
            ...constructorStatements.slice(1)
        ];
    } else {
        constructorStatements = [...fieldStatements, ...privateInstanceStatements, ...constructorStatements];
    }

    const constructorBody = constructorStatements.map((statement) => escodegen.generate(statement)).join("\n");

    let code = `${Array.from(privateFields.values()).map((field) => `const ${field.storageName} = new WeakMap();`).join("\n")}${privateFields.size ? "\n" : ""}`;
    code += `function ${className}(${constructorParams}) {\n${constructorBody}\n}\n`;

    if (superClassCode) {
        code += `${className}.prototype = Object.create(${superClassCode}.prototype);\n`;
        code += `${className}.prototype.constructor = ${className};\n`;
        code += `Object.setPrototypeOf(${className}, ${superClassCode});\n`;
    }

    const accessorGroups = new Map();

    for (const method of node.body.body) {
        if (method.kind === "constructor") continue;
        if (method.type === "PropertyDefinition") {
            continue;
        }
        if (method.type !== "MethodDefinition") {
            throw new Error(`Unsupported class element: ${method.type}`);
        }
        if (method.key.type === "PrivateIdentifier") {
            continue;
        }

        if (method.kind === "method") {
            const target = method.static
                ? `${className}${getPropertyAccessorCode(method.key, method.computed)}`
                : `${className}.prototype${getPropertyAccessorCode(method.key, method.computed)}`;
            const params = method.value.params.map((param) => escodegen.generate(param)).join(", ");
            const body = method.value.body.body
                .map((statement) =>
                    escodegen.generate(
                        transformSuperStatement(
                            transformPrivateStatement(desugarStatement(statement), privateFields),
                            {
                                superClassCode,
                                isStatic: method.static,
                                inConstructor: false
                            }
                        )
                    )
                )
                .join("\n");

            code += `${target} = function(${params}) {\n${body}\n};\n`;
            continue;
        }

        if (method.kind === "get" || method.kind === "set") {
            const groupKey = `${method.static ? "static" : "instance"}:${method.computed ? escodegen.generate(method.key) : getPropertyAccessorCode(method.key, false)}`;
            if (!accessorGroups.has(groupKey)) {
                accessorGroups.set(groupKey, {
                    static: method.static,
                    computed: method.computed,
                    key: method.key,
                    get: null,
                    set: null
                });
            }
            accessorGroups.get(groupKey)[method.kind] = method;
            continue;
        }

        throw new Error(`Unsupported class method kind: ${method.kind}`);
    }

    for (const group of accessorGroups.values()) {
        const target = group.static ? className : `${className}.prototype`;
        const keyCode = group.computed
            ? escodegen.generate(group.key)
            : JSON.stringify(group.key.type === "Identifier" ? group.key.name : group.key.value);

        const descriptorParts = [];

        if (group.get) {
            const params = group.get.value.params.map((param) => escodegen.generate(param)).join(", ");
            const body = group.get.value.body.body
                .map((statement) =>
                    escodegen.generate(
                        transformSuperStatement(
                            transformPrivateStatement(desugarStatement(statement), privateFields),
                            {
                                superClassCode,
                                isStatic: group.static,
                                inConstructor: false
                            }
                        )
                    )
                )
                .join("\n");
            descriptorParts.push(`get: function(${params}) {\n${body}\n}`);
        }

        if (group.set) {
            const params = group.set.value.params.map((param) => escodegen.generate(param)).join(", ");
            const body = group.set.value.body.body
                .map((statement) =>
                    escodegen.generate(
                        transformSuperStatement(
                            transformPrivateStatement(desugarStatement(statement), privateFields),
                            {
                                superClassCode,
                                isStatic: group.static,
                                inConstructor: false
                            }
                        )
                    )
                )
                .join("\n");
            descriptorParts.push(`set: function(${params}) {\n${body}\n}`);
        }

        descriptorParts.push("configurable: true");

        code += `Object.defineProperty(${target}, ${keyCode}, {${descriptorParts.join(", ")}});\n`;
    }

    for (const field of staticFields) {
        if (field.key.type === "PrivateIdentifier") {
            continue;
        }
        code += `${buildFieldInitializationCode(field, className, privateFields)}\n`;
    }

    for (const info of Array.from(privateFields.values()).filter((entry) => entry.static)) {
        code += `${buildPrivateMemberInitializationCode(info, className, privateFields, {
            superClassCode,
            isStatic: true,
            inConstructor: false
        })}\n`;
    }

    return code;
}

function classDeclarationToStatements(node) {
    if (!node.id) {
        throw new Error("Anonymous class declarations are not supported");
    }

    return parseStatements(buildClassBodyCode(node, node.id.name));
}

function classExpressionToExpression(node) {
    const className = node.id ? node.id.name : `_class_${Math.random().toString(16).slice(2)}`;
    const code = `(function() {\n${buildClassBodyCode(node, className)}return ${className};\n})()`;
    return parseExpression(code);
}

function desugarExpression(expression) {
    if (!expression) return expression;

    switch (expression.type) {
        case "ClassExpression":
            return classExpressionToExpression(expression);
        case "AssignmentExpression":
            expression.left = desugarExpression(expression.left);
            expression.right = desugarExpression(expression.right);
            return expression;
        case "BinaryExpression":
        case "LogicalExpression":
            expression.left = desugarExpression(expression.left);
            expression.right = desugarExpression(expression.right);
            return expression;
        case "UnaryExpression":
        case "UpdateExpression":
            expression.argument = desugarExpression(expression.argument);
            return expression;
        case "ConditionalExpression":
            expression.test = desugarExpression(expression.test);
            expression.consequent = desugarExpression(expression.consequent);
            expression.alternate = desugarExpression(expression.alternate);
            return expression;
        case "CallExpression":
        case "NewExpression":
            expression.callee = desugarExpression(expression.callee);
            expression.arguments = expression.arguments.map(desugarExpression);
            return expression;
        case "MemberExpression":
            expression.object = desugarExpression(expression.object);
            expression.property = desugarExpression(expression.property);
            return expression;
        case "ArrayExpression":
            expression.elements = expression.elements.map((element) => desugarExpression(element));
            return expression;
        case "ObjectExpression":
            expression.properties.forEach((property) => {
                if (property.type === "Property") {
                    property.value = desugarExpression(property.value);
                    if (property.computed) {
                        property.key = desugarExpression(property.key);
                    }
                }
            });
            return expression;
        case "SequenceExpression":
            expression.expressions = expression.expressions.map(desugarExpression);
            return expression;
        case "TemplateLiteral":
            expression.expressions = expression.expressions.map(desugarExpression);
            return expression;
        case "ArrowFunctionExpression":
        case "FunctionExpression":
            if (expression.body && expression.body.type === "BlockStatement") {
                expression.body.body = desugarStatementList(expression.body.body);
            } else if (expression.body) {
                expression.body = desugarExpression(expression.body);
            }
            return expression;
        case "AwaitExpression":
        case "SpreadElement":
            expression.argument = desugarExpression(expression.argument);
            return expression;
        default:
            return expression;
    }
}

function desugarStatement(statement) {
    if (!statement) return statement;

    switch (statement.type) {
        case "ExpressionStatement": {
            statement.expression = desugarExpression(statement.expression);
            break;
        }
        case "BlockStatement": {
            statement.body = desugarStatementList(statement.body);
            break;
        }
        case "IfStatement": {
            statement.test = desugarExpression(statement.test);
            statement.consequent = desugarStatement(statement.consequent);
            if (statement.alternate) {
                statement.alternate = desugarStatement(statement.alternate);
            }
            break;
        }
        case "ReturnStatement":
        case "ThrowStatement": {
            statement.argument = desugarExpression(statement.argument);
            break;
        }
        case "VariableDeclaration": {
            statement.declarations.forEach((declaration) => {
                declaration.init = desugarExpression(declaration.init);
            });
            break;
        }
        case "ForStatement": {
            if (statement.init) {
                if (statement.init.type === "VariableDeclaration") {
                    desugarStatement(statement.init);
                } else {
                    statement.init = desugarExpression(statement.init);
                }
            }
            if (statement.test) statement.test = desugarExpression(statement.test);
            if (statement.update) statement.update = desugarExpression(statement.update);
            statement.body = desugarStatement(statement.body);
            break;
        }
        case "ForInStatement":
        case "ForOfStatement": {
            if (statement.left) {
                if (statement.left.type === "VariableDeclaration") {
                    desugarStatement(statement.left);
                } else {
                    statement.left = desugarExpression(statement.left);
                }
            }
            if (statement.right) statement.right = desugarExpression(statement.right);
            statement.body = desugarStatement(statement.body);
            break;
        }
        case "WhileStatement":
        case "DoWhileStatement":
        case "LabeledStatement": {
            if (statement.test) statement.test = desugarExpression(statement.test);
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
            statement.discriminant = desugarExpression(statement.discriminant);
            statement.cases.forEach((switchCase) => {
                switchCase.test = desugarExpression(switchCase.test);
                switchCase.consequent = desugarStatementList(switchCase.consequent);
            });
            break;
        }
        case "FunctionDeclaration":
        case "FunctionExpression":
        case "ArrowFunctionExpression": {
            if (statement.body && statement.body.type === "BlockStatement") {
                statement.body.body = desugarStatementList(statement.body.body);
            } else if (statement.body) {
                statement.body = desugarExpression(statement.body);
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
