// Where the TokGlass API (worker/) runs. No trailing slash.
// A page opened on localhost talks to `npm run api:dev`.
window.TOKGLASS_API = /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
  ? 'http://localhost:8787'
  : '';
