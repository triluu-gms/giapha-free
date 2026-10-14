// Vercel serverless entry point: every request is rewritten here (see vercel.json)
// and handled by the Express app.
//
// Plain JavaScript on purpose: Vercel runs `npm run build` (tsc -> dist/) first, and
// this file loads that output. Vercel then has no TypeScript of its own to compile,
// which its builder doesn't do reliably with TypeScript 7.
module.exports = require('../dist/src/app.js').default;
