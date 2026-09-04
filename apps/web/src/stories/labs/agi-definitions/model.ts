export interface AgiDefinition {
  id: string;
  label: string;
  generality: number;
  capability: number;
  autonomy: number;
}

export interface AgiPosition {
  generality: number;
  capability: number;
  autonomy: number;
}

/** Reads three independent coordinates from an authored definition. */
export function positionDefinition(definition: AgiDefinition): AgiPosition {
  assertFinite(definition, 'generality');
  assertFinite(definition, 'capability');
  assertFinite(definition, 'autonomy');
  return {
    generality: definition.generality,
    capability: definition.capability,
    autonomy: definition.autonomy,
  };
}

/** Compares definitions coordinate by coordinate, without collapsing them to a total. */
export function compareDefinitions(left: AgiDefinition, right: AgiDefinition): AgiPosition {
  const leftPosition = positionDefinition(left);
  const rightPosition = positionDefinition(right);
  const difference = {
    generality: leftPosition.generality - rightPosition.generality,
    capability: leftPosition.capability - rightPosition.capability,
    autonomy: leftPosition.autonomy - rightPosition.autonomy,
  };
  for (const axis of Object.keys(difference) as Array<keyof AgiPosition>) {
    if (!Number.isFinite(difference[axis])) {
      throw new Error(`Definition comparison has a non-finite ${axis} difference.`);
    }
  }
  return difference;
}

function assertFinite(definition: AgiDefinition, axis: keyof AgiPosition) {
  if (!Number.isFinite(definition[axis])) {
    throw new Error(`Definition "${definition.label}" has a non-finite ${axis} coordinate.`);
  }
  if (definition[axis] < 0 || definition[axis] > 5) {
    throw new Error(`Definition "${definition.label}" has an out-of-range ${axis} coordinate.`);
  }
}
