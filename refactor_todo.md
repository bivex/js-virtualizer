# Refactor TODO

jscodeshift проверен — работает на 39/41 файлах (2 файла с `arguments` дестрактором нужно парсить через `--parser babillon` или переименовать).

---

## 1. Extract loop break/continue epilogue (приоритет: высокий)

**Файлы:** 4-6, **~70 строк**

Одинаковый блок `getProcessStack` → `while` → `pop()` в:

- `src/transformations/ForStatement.js` (52-76)
- `src/transformations/WhileStatement.js` (44-64)
- `src/transformations/ForOfStatement.js` (49-69)
- `src/transformations/ForInStatement.js` (50-70)
- `src/transformations/SwitchStatement.js` (82-98) — variant с `'switch'`
- `src/transformations/FunctionDeclaration.js` (142-160) — variant с `'vfunc'`

```js
// Паттерн (повторяется 6 раз):
const processStack = this.getProcessStack('loops')
while (processStack.length) {
    const top = processStack[processStack.length - 1]
    if (top.label !== label) { break }
    const {type, ip} = top.metadata
    switch (type) {
        case 'break': { top.modifyArgs(...); break }
        case 'continue': { top.modifyArgs(...); break }
    }
    processStack.pop()
}
```

**Решение:** `this.resolvePendingJumps(label, contextType)` на BytecodeGenerator.

---

## 2. Extract array-setup-and-populate (приоритет: высокий)

**Файлы:** 4-5, **~60 строк**

```js
const argsRegister = this.getAvailableTempLoad()
const counterRegister = this.getAvailableTempLoad()
const oneRegister = this.getAvailableTempLoad()
this.chunk.append(new Opcode('SETUP_ARRAY', argsRegister, this.encodeDWORD(count)));
this.chunk.append(new Opcode('LOAD_DWORD', counterRegister, this.encodeDWORD(0)));
this.chunk.append(new Opcode('LOAD_DWORD', oneRegister, this.encodeDWORD(1)));
items.forEach((item) => {
    this.chunk.append(new Opcode('SET_INDEX', argsRegister, counterRegister, itemRegister));
    this.chunk.append(new Opcode('ADD', counterRegister, counterRegister, oneRegister));
})
this.freeTempLoad(counterRegister)
this.freeTempLoad(oneRegister)
```

**Где:** CallExpression.js (33-57), NewExpression.js (30-52), ArrayExpression.js (23-38), AssignmentExpression.js (64-77), BytecodeGenerator.js (534-546)

**Решение:** `this.buildArrayFromItems(items, itemSetupFn)`.

---

## 3. Merge BinaryExpression / LogicalExpression (приоритет: средний)

**Файлы:** 2, **~70 строк**

Оба файла структурно идентичны (81 строка каждый), отличаются только:
- Имя хелпера: `isNestedBinaryExpression` vs `isNestedLogicalExpression`
- Тип: `'BinaryExpression'` vs `'LogicalExpression'`
- Маппинг операторов: `binaryOperatorToOpcode` vs `logicalOperatorToOpcode`

**Решение:** `createBinaryLikeResolver(typeName, operatorMapFn)`.

---

## 4. Normalize require() prefixes (приоритет: низкий)

**Файлы:** 8-10, стиль

Микс `require("node:fs")` и `require("fs")`:
- `crypto` и `assert` — всегда без префикса
- `fs`, `path`, `zlib` — с префиксом `node:` в одних файлах, без в других

**Решение:**统一 до `require("node:...")`.

---

## 5. Normalize module.exports semicolons (приоритет: низкий)

**Файлы:** 17, стиль

- С `;`: BinaryExpression, LogicalExpression, UnaryExpression, UpdateExpression, SequenceExpression, AwaitExpression, ThrowStatement, AssignmentExpression
- Без `;`: IfStatement, ForStatement, WhileStatement, ForOfStatement, ForInStatement, SwitchStatement, CallExpression, ArrayExpression, ObjectExpression, MemberExpression, resolveToRegister, TemplateLiteral, FunctionDeclaration, NewExpression, SpreadElement, AssignmentPattern, ConditionalExpression

**Решение:** jscodeshift codemod — добавить `;` везде.

---

## 6. Fix copy-paste log message bugs (приоритет: высокий — баг)

**Файлы:** 2

- `WhileStatement.js:54` и `:59` — говорит `"for of loop"` вместо `"while loop"`
- `ForInStatement.js:60` и `:65` — говорит `"for of loop"` вместо `"for in loop"`

**Решение:** Простой текстовый фикс.

---

## 7. Extract encoding iteration in transpile.js (приоритет: средний)

**Файлы:** 1, **~15 строк**

Три функции с идентичной структурой:
- `applyStatefulOpcodeEncoding()` (714-720)
- `applyJumpTargetEncoding()` (723-738)
- `applyPerInstructionEncoding()` (741-749)

```js
function applyXxxEncoding(chunk, seed, ...) {
    let position = 0;
    for (const opcode of chunk.code) {
        // transform
        position += opcode.toBytes().length;
    }
}
```

**Решение:** `iterateOpcodes(chunk, seed, transformFn)`.

---

## 8. Consolidate vm_dev.js / vm_dist.js shared code (приоритет: высокий — 300+ строк)

**Файлы:** 2, **~300+ строк**

`vm_dist.js` — self-contained bundle, дублирует:
- `rotateLeft()`, `createBytecodeIntegrityDigest()`, `createSeedFromString()`, `createSeededPermutation()`
- `encodeUtf8()`, `createBytecodeCipherBuffer()`
- `deriveOpcodeStateSeed()`, `transformJumpTargetBytes()`, `transformInstructionBytes()`
- `resolveRegisteredBytecodeKey()`, register/opcode constants
- `formatDouble()`, `parseDoubleBits()`

**Решение:** Скрипт генерации `vm_dist.js` из `vm_dev.js` + инлайн зависимостей.

---

## 9. CommonJS → ESM (приоритет: низкий —现代化)

**Файлы:** 39

Все файлы используют `require()` / `module.exports`. BytecodeGenerator.js имеет 31 `require()` вызов.

**Решение:** jscodeshift CJS→ESM codemod (стандартная трансформация).

---

## 10. Duplicate imports in transpile.js (приоритет: низкий)

```js
const {readFileSync, writeFileSync} = require("node:fs")  // line 23
const fs = require("node:fs")                              // line 33
```

**Решение:** Оставить только `const fs = require("node:fs")`.

---

## Порядок выполнения

```
1. Fix #6 (log bugs)                    — точечный фикс, 2 файла
2. Fix #10 (duplicate imports)          — точечный фикс, 1 файл
3. Fix #5 (semicolons)                  — jscodeshift, 0 риск
4. Fix #4 (require prefixes)            — jscodeshift, 0 риск
5. Fix #1 (loop epilogue)               — extract method, нужен тест
6. Fix #2 (array setup)                 — extract method, нужен тест
7. Fix #7 (encoding iteration)          — extract function
8. Fix #3 (BinaryExpression merge)      — refactor, нужен тест
9. Fix #8 (vm_dev/vm_dist)              — build system, высокий риск
```

**Правило:** git commit перед каждым шагом, `--dry` перед каждым jscodeshift.
