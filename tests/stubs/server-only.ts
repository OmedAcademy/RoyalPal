// The real `server-only` package throws when imported outside a React Server
// Component graph, which would make every server module untestable. Vitest
// aliases the specifier to this no-op so server modules can be unit tested;
// the guard still applies to the real Next.js build.
export {};
