// Fixture: a worker that crashes immediately on start.
// Used to prove PluginHost backoff keeps escalating when a worker never
// reaches a healthy state (no reply ever resets the backoff).
throw new Error('intentional crash on start');
