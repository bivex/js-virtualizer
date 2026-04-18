/**
 * Add semicolons to module.exports statements that are missing them.
 */

module.exports = function transformer(file, api) {
  const j = api.jscodeshift;
  const root = j(file.source);

  root
    .find(j.ExpressionStatement)
    .filter(path => {
      const expr = path.value.expression;
      return expr.type === 'AssignmentExpression' &&
        expr.left.type === 'MemberExpression' &&
        expr.left.object.name === 'module' &&
        expr.left.property.name === 'exports';
    })
    .forEach(path => {
      if (!path.value.semicolon) {
        path.value.semicolon = true;
      }
    });

  return root.toSource({ quote: 'single' });
};
