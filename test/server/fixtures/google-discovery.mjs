// Test-only network fixture. Production never imports this file. No token grants,
// user identity, signing keys, or authenticated sessions are fabricated here.
globalThis.fetch = async (input) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url !== "https://accounts.google.com/.well-known/openid-configuration") {
    throw new Error("Unexpected network request in startup smoke test");
  }
  return Response.json({
    issuer: "https://accounts.google.com",
    authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
    token_endpoint: "https://oauth2.googleapis.com/token",
    jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
    response_types_supported: ["code"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    code_challenge_methods_supported: ["S256"],
  });
};
