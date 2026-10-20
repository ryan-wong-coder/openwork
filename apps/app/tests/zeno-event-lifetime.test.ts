import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

function eventLifetimeViolations(text: string, filename: string) {
    const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), violations: string[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
        const names = new Set(node.parameters.flatMap(parameter => ts.isIdentifier(parameter.name) ? [parameter.name.text] : []));
        let firstAwait = Infinity;
        const awaits = (child: ts.Node) => { if (child !== node.body && (ts.isArrowFunction(child) || ts.isFunctionExpression(child))) return; if (ts.isAwaitExpression(child)) firstAwait = Math.min(firstAwait, child.getStart(source)); ts.forEachChild(child, awaits); };
        awaits(node.body);
        const check = (child: ts.Node, depth: number) => {
          if (child !== node.body && (ts.isArrowFunction(child) || ts.isFunctionExpression(child))) { if (child.parameters.some(parameter => ts.isIdentifier(parameter.name) && names.has(parameter.name.text))) return; depth++; }
          if ((depth || child.getStart(source) > firstAwait) && ts.isPropertyAccessExpression(child) && child.name.text === "currentTarget" && ts.isIdentifier(child.expression) && names.has(child.expression.text)) { const line = source.getLineAndCharacterOfPosition(child.getStart(source)).line + 1; violations.push(filename + ":" + line); }
          ts.forEachChild(child, next => check(next, depth));
        };
        check(node.body, 0);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    return violations;
}
test("the event-lifetime audit catches deferred state and await reads while allowing captured primitives", () => {
  expect(eventLifetimeViolations("const bad = event => setDraft(previous => event.currentTarget.value);", "fixture.tsx")).toHaveLength(1);
  expect(eventLifetimeViolations("const bad = async event => { await pause(); setText(event.currentTarget.value); };", "fixture.tsx")).toHaveLength(1);
  expect(eventLifetimeViolations("const safe = event => { const value = event.currentTarget.value; setDraft(previous => value); };", "fixture.tsx")).toEqual([]);
});
test("React event currentTarget never escapes into deferred state or async closures", () => {
  const directory = join(import.meta.dir, "../src/react-app/domains/zeno"), violations: string[] = [];
  for (const filename of readdirSync(directory).filter(name => name.endsWith(".tsx"))) violations.push(...eventLifetimeViolations(readFileSync(join(directory, filename), "utf8"), filename));
  expect(violations).toEqual([]);
});
