// Records each visit, each run milestone and every crash to the artifact db so playtests are timed and errors seen without asking.
export function createTelemetry(state, fps) {
  let db = null, session = null;
  const pending = [], chains = {};
  const id = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  // Writes to one document strictly one after another; queued until the db answers.
  const put = (path, data) => {
    const run = () => { chains[path] = (chains[path] ?? Promise.resolve()).then(() => db.doc(path).set(data)).catch(() => {}); };
    if (db) run(); else pending.push(run);
  };

  const begin = () => {
    session = { path: `sessions/${id()}`, data: { runId: state.runId, startedAt: new Date().toISOString(), playSecAtStart: Math.round(state.playSec) } };
    put(session.path, session.data);
  };
  const end = () => {
    if (!session) return;
    const { path, data } = session;
    put(path, { ...data, endedAt: new Date().toISOString(), activeSec: Math.round(state.playSec) - data.playSecAtStart, fps: fps() });
    session = null;
  };

  window.claude?.use('db').then((d) => {
    db = d;
    if (db) pending.splice(0).forEach((run) => run());
  });
  begin();
  // Crashes are counted too: every uncaught error and failed promise goes in with the build and where it was thrown.
  let errors = 0;
  const crash = (message, where) => { if (errors++ < 20) put(`runs/${state.runId}/errors/${id()}`, { message: String(message).slice(0, 300), where: String(where ?? '').slice(0, 200), playSec: Math.round(state.playSec), at: new Date().toISOString() }); };
  addEventListener('error', (e) => crash(e.message, `${e.filename}:${e.lineno}`));
  addEventListener('unhandledrejection', (e) => crash(e.reason?.message ?? e.reason, e.reason?.stack?.split('\n')[1]));
  document.addEventListener('visibilitychange', () => (document.hidden ? end() : begin()));
  addEventListener('pagehide', end);

  return {
    milestone(name) {
      put(`runs/${state.runId}/events/${name}`, { name, playSec: Math.round(state.playSec), fps: fps(), at: new Date().toISOString() });
    },
  };
}
