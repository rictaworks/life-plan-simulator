import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { createGoogleProvider } from "../../src/server/oidc.js";

const issuer = "https://accounts.google.com";
const redirectUri = "https://app.example.test/auth/callback";
const transaction = {
  state: "test-state",
  nonce: "test-nonce",
  verifier: "a".repeat(64),
};
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let otherKeys: Awaited<ReturnType<typeof generateKeyPair>>;
beforeAll(async () => {
  keys = await generateKeyPair("RS256");
  otherKeys = await generateKeyPair("RS256");
});
afterEach(() => vi.unstubAllGlobals());

async function fixture(
  overrides: Record<string, unknown> = {},
  forged = false,
  missingToken = false,
) {
  const jwt = await new SignJWT({
    iss: issuer,
    sub: "google-user-123",
    aud: "test-client",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 600,
    nonce: transaction.nonce,
    email: "person@example.test",
    email_verified: true,
    ...overrides,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .sign(forged ? otherKeys.privateKey : keys.privateKey);
  const fetchMock = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith("/.well-known/openid-configuration"))
        return Response.json({
          issuer,
          authorization_endpoint: `${issuer}/o/oauth2/v2/auth`,
          token_endpoint: "https://oauth2.googleapis.com/token",
          jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
          response_types_supported: ["code"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["RS256"],
        });
      if (url === "https://www.googleapis.com/oauth2/v3/certs")
        return Response.json({
          keys: [
            {
              ...(await exportJWK(keys.publicKey)),
              kid: "test-key",
              alg: "RS256",
              use: "sig",
            },
          ],
        });
      if (url === "https://oauth2.googleapis.com/token") {
        expect(
          new URLSearchParams(String(init?.body)).get("code_verifier"),
        ).toBe(transaction.verifier);
        return Response.json({
          access_token: "test-access-token",
          token_type: "Bearer",
          ...(missingToken ? {} : { id_token: jwt }),
        });
      }
      throw new Error("Unexpected network destination");
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  const provider = await createGoogleProvider({
    clientId: "test-client",
    clientSecret: "test-secret",
    redirectUri,
  });
  return { provider, fetchMock };
}
const callback = (state = transaction.state) =>
  new URL(`${redirectUri}?code=test-code&state=${state}`);

describe("Google OIDC", () => {
  it("requests only identity scopes with S256 PKCE, state, nonce and fixed redirect", async () => {
    const { provider } = await fixture();
    const url = provider.authorization(transaction);
    expect(url.origin).toBe(issuer);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      scope: "openid email",
      state: transaction.state,
      nonce: transaction.nonce,
      code_challenge_method: "S256",
      response_type: "code",
      redirect_uri: redirectUri,
    });
    expect(url.searchParams.get("code_challenge")).toHaveLength(43);
    expect(url.toString()).not.toContain(transaction.verifier);
  });
  it("accepts a correctly signed identity", async () => {
    const { provider } = await fixture();
    await expect(provider.callback(callback(), transaction)).resolves.toEqual({
      issuer,
      subject: "google-user-123",
      email: "person@example.test",
    });
  });
  it.each([
    ["issuer", { iss: "https://attacker.test" }],
    ["audience", { aud: "other-client" }],
    ["expiration", { exp: 1 }],
    ["nonce", { nonce: "wrong" }],
    ["subject", { sub: "" }],
    ["unverified email", { email_verified: false }],
    ["missing email", { email: undefined }],
  ])("rejects invalid %s", async (_name, claims) => {
    const { provider } = await fixture(claims);
    await expect(provider.callback(callback(), transaction)).rejects.toThrow();
  });
  it("rejects a forged signature even when all claims match", async () => {
    const { provider } = await fixture({}, true);
    await expect(provider.callback(callback(), transaction)).rejects.toThrow();
  });
  it("requires an ID token", async () => {
    const { provider } = await fixture({}, false, true);
    await expect(provider.callback(callback(), transaction)).rejects.toThrow();
  });
  it("rejects state mismatch before exchanging code", async () => {
    const { provider, fetchMock } = await fixture();
    await expect(
      provider.callback(callback("wrong"), transaction),
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("rejects provider cancellation", async () => {
    const { provider } = await fixture();
    await expect(
      provider.callback(
        new URL(
          `${redirectUri}?error=access_denied&state=${transaction.state}`,
        ),
        transaction,
      ),
    ).rejects.toThrow();
  });
  it("rejects callback URI substitution", async () => {
    const { provider } = await fixture();
    await expect(
      provider.callback(
        new URL(
          `https://other.test/auth/callback?code=test-code&state=${transaction.state}`,
        ),
        transaction,
      ),
    ).rejects.toThrow();
  });
});
