/**
 * Factory to create binary-like expression resolvers.
 * Supports both BinaryExpression and LogicalExpression with minor variations.
 */
const {log, LogData} = require("../utils/log");
const {Opcode} = require("../utils/assembler");

function createBinaryLikeResolver(typeName, operatorMap) {
    function resolver(node, forceImmutableMerges) {
        const {left, right, operator} = node;
        const opcode = operatorMap(operator);
        let finalL, finalR;
        let leftIsImmutable = false, rightIsImmutable = false;

        log(`Evaluating ${typeName}: ${left.type} ${operator} ${right.type}`);

        // Helper to check if node is a nested expression of the same type
        const isNested = (n) => n.left.type === typeName || n.right.type === typeName;

        // Recursively resolve left if it's a nested expression
        if (left.type === typeName && isNested(left)) {
            finalL = resolver.call(this, left);
            log(`Result left is at ${this.TLMap[finalL]}`);
        }

        // Recursively resolve right if it's a nested expression
        if (right.type === typeName && isNested(right)) {
            finalR = resolver.call(this, right);
            log(`Result right is at ${this.TLMap[finalR]}`);
        }

        // Resolve left if not already resolved
        if (!finalL) {
            const {outputRegister, borrowed} = this.resolveExpression(left);
            finalL = outputRegister;
            leftIsImmutable = borrowed;
            log(`Left is at ${this.TLMap[finalL]}`);
        }

        // Resolve right if not already resolved
        if (!finalR) {
            const {outputRegister, borrowed} = this.resolveExpression(right);
            finalR = outputRegister;
            rightIsImmutable = borrowed;
            log(`Right is at ${this.TLMap[finalR]}`);
        }

        // always merge to the left
        const mergeTo = forceImmutableMerges
            ? this.getAvailableTempLoad()
            : (leftIsImmutable ? (rightIsImmutable ? this.getAvailableTempLoad() : finalR) : finalL);

        this.chunk.append(new Opcode(opcode, mergeTo, finalL, finalR));

        const leftTL = this.TLMap[finalL];
        const rightTL = this.TLMap[finalR];
        const mergedTL = this.TLMap[mergeTo];

        if (leftTL && leftTL !== mergedTL && !leftIsImmutable) {
            this.freeTempLoad(finalL);
            log(`${typeName} resolver: ${leftTL}`);
        }

        if (rightTL && rightTL !== mergedTL && !rightIsImmutable) {
            this.freeTempLoad(finalR);
            log(`${typeName} resolver: ${rightTL}`);
        }

        log(`Evaluated ${typeName}: ${left.type} ${operator} ${right.type} to ${mergedTL}`);

        return mergeTo;
    }

    return resolver;
}

module.exports = {createBinaryLikeResolver};
