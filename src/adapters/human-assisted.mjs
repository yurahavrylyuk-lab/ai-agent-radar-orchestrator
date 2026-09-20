export function prepareHumanTask({ role, instructions }) {
  return { status: "AWAITING_HUMAN_ROLE", task: { role, instructions, simulated: true }, launched: false };
}
