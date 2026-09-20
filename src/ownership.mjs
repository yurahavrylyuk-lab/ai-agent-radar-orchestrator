export function assertOwnership(state, claim) {
  if (claim.ownerId !== state.owner.id) throw new Error("WRONG_OWNER");
  if (claim.generation !== state.owner.generation) throw new Error("STALE_GENERATION");
  if (claim.stateVersion !== state.stateVersion) throw new Error("WRONG_STATE_VERSION");
  return true;
}
export function nextOwnership(state, ownerId) {
  return { ...structuredClone(state), stateVersion: state.stateVersion + 1, owner: { id: ownerId, generation: state.owner.generation + 1 } };
}
