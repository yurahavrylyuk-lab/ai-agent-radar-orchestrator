export function fakeGit({ tip = "baseline", publication = "LOCAL_ONLY" } = {}) {
  return {
    assertTip(expected) { if (tip !== expected) throw new Error("UNEXPECTED_GIT_TIP"); return true; },
    publish() { if (publication === "UNCERTAIN") throw new Error("UNCERTAIN_PUBLICATION"); return { status: publication, simulated: true }; },
  };
}
