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

const {shuffle} = require("../utils/random");
const {opNames} = require("../utils/constants");
const {log} = require("../utils/log");

function findTopLevelVariable(vmAST, name) {
    return vmAST.body.find((node) => {
        return node.type === "VariableDeclaration" && node.declarations.some((declaration) => {
            return declaration.id && declaration.id.name === name;
        });
    });
}

function obfuscateOpcodes(VMChunks, vmAST) {
    const usedOps = new Set()

    for (const VMChunk of VMChunks) {
        VMChunk.code.forEach(opcode => {
            usedOps.add(opcode.name)
        })

        VMChunk.setMetadata({
            usedOpnames: usedOps
        })
    }

    const newOpnames = Array.from(usedOps)
    for (let i = 0; i < opNames.length - newOpnames.length; i++) {
        newOpnames.push("NOP")
    }
    shuffle(newOpnames)

    const remapped = {}

    for (let i = 0; i < newOpnames.length; i++) {
        if (usedOps.has(newOpnames[i])) {
            log(`Remapping ${newOpnames[i]} to ${i}`)
            remapped[newOpnames[i]] = i
        }
    }

    for (const VMChunk of VMChunks) {
        VMChunk.code.forEach(opcode => {
            opcode.opcode = Buffer.from([remapped[opcode.name]])
        })
    }

    const opNamesDeclaration = findTopLevelVariable(vmAST, "opNames")
    if (!opNamesDeclaration) {
        throw new Error("Failed to locate opNames declaration in VM AST");
    }

    const opcodesArrayExpression = opNamesDeclaration.declarations.find((declaration) => {
        return declaration.id && declaration.id.name === "opNames";
    }).init
    opcodesArrayExpression.elements = []

    for (let i = 0; i < newOpnames.length; i++) {
        opcodesArrayExpression.elements.push({
            type: "Literal",
            value: newOpnames[i],
            raw: `"${newOpnames[i]}"`
        })
    }
}

module.exports = obfuscateOpcodes
