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

const {needsCleanup} = require("../utils/constants");
const {log} = require("../utils/log");

// mutability depends on the final expression
function resolveSequenceExpression(expression) {
    const expressions = expression.expressions;
    let outputRegister = null;
    let borrowed = false;

    log(`Resolving sequence expression: ${expressions.map(e => e.type).join(', ')}`);

    for (let i = 0; i < expressions.length; i++) {
        log(`Sequence resolving: ${expressions[i].type}`);
        const expr = expressions[i];
        const res = this.resolveExpression(expr)
        outputRegister = res.outputRegister;
        borrowed = res.borrowed;
        if (i < expressions.length - 1 && needsCleanup(expr)) this.freeTempLoad(outputRegister);
    }

    return {outputRegister, borrowed};
}

module.exports = resolveSequenceExpression;
