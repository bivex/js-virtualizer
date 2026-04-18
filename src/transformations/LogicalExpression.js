const {logicalOperatorToOpcode} = require("../utils/constants");
const {createBinaryLikeResolver} = require("../utils/binaryLikeResolver");

const resolveLogicalExpression = createBinaryLikeResolver('LogicalExpression', logicalOperatorToOpcode);
module.exports = resolveLogicalExpression;
