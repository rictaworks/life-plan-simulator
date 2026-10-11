import { caseSchema, type CaseInput } from "./schema.js";
/** The caller supplies a fresh identifier; nested events are independent as well. */
export function cloneCase(
  original: CaseInput,
  newId: string,
  name = original.name,
): CaseInput {
  return caseSchema.parse({
    ...original,
    id: newId,
    name,
    events: original.events.map((event, index) => ({
      ...event,
      id: `${newId.slice(0, 90)}_${index}`,
    })),
  });
}
