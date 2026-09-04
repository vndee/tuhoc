export interface RuleNode {
  id: string;
  parentId: string | null;
}

/** Returns every downstream rule once, in stable authored breadth-first order. */
export function descendantIds(nodes: RuleNode[], changedRuleId: string): string[] {
  const childrenByParent = validateRuleGraph(nodes, changedRuleId);
  const descendants: string[] = [];
  const seen = new Set<string>([changedRuleId]);
  const pending = [...(childrenByParent.get(changedRuleId) ?? [])];

  for (let index = 0; index < pending.length; index += 1) {
    const id = pending[index];
    if (seen.has(id)) continue;
    seen.add(id);
    descendants.push(id);
    pending.push(...(childrenByParent.get(id) ?? []));
  }

  return descendants;
}

/** Counts the authored descendants whose maintenance is affected by a rule change. */
export function countAffectedRules(nodes: RuleNode[], changedRuleId: string): number {
  return descendantIds(nodes, changedRuleId).length;
}

function validateRuleGraph(nodes: RuleNode[], changedRuleId: string): Map<string, string[]> {
  const ids = new Set<string>();
  for (const node of nodes) {
    if (ids.has(node.id)) throw new Error('Rule nodes must have unique ids.');
    ids.add(node.id);
  }
  if (!ids.has(changedRuleId)) throw new Error(`Rule "${changedRuleId}" does not exist.`);

  const childrenByParent = new Map<string, string[]>();
  for (const node of nodes) {
    if (node.parentId === null) continue;
    if (!ids.has(node.parentId)) throw new Error(`Rule "${node.id}" references missing parent "${node.parentId}".`);
    const children = childrenByParent.get(node.parentId) ?? [];
    children.push(node.id);
    childrenByParent.set(node.parentId, children);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) throw new Error('Rule graph contains a cycle.');
    if (visited.has(id)) return;
    visiting.add(id);
    for (const child of childrenByParent.get(id) ?? []) visit(child);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of ids) visit(id);
  return childrenByParent;
}
