const {binaryOperatorToOpcode} = require("../utils/constants");
const {createBinaryLikeResolver} = require("../utils/binaryLikeResolver");

const resolveBinaryExpression = createBinaryLikeResolver('BinaryExpression', binaryOperatorToOpcode);
module.exports = resolveBinaryExpression;
