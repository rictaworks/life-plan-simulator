import { createHash } from "node:crypto";
import * as oidc from "openid-client";

export interface AuthTransaction {
  state: string;
  nonce: string;
  verifier: string;
}
export interface IdentityProvider {
  authorization(transaction: AuthTransaction): URL;
  callback(
    url: URL,
    transaction: AuthTransaction,
  ): Promise<{ issuer: string; subject: string; email: string }>;
}

const GOOGLE_ISSUER = "https://accounts.google.com";

/** Production issuer is deliberately fixed; mock network responses only in tests. */
export async function createGoogleProvider(options: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<IdentityProvider> {
  const redirect = new URL(options.redirectUri);
  if (
    !options.clientId ||
    !options.clientSecret ||
    redirect.search ||
    redirect.hash ||
    redirect.username ||
    redirect.password ||
    (redirect.protocol !== "https:" &&
      !(
        redirect.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(redirect.hostname)
      ))
  ) {
    throw new Error("Invalid OIDC configuration");
  }
  const config = await oidc.discovery(
    new URL(GOOGLE_ISSUER),
    options.clientId,
    options.clientSecret,
    undefined,
    {
      execute: [oidc.enableNonRepudiationChecks],
    },
  );
  return {
    authorization(transaction) {
      return oidc.buildAuthorizationUrl(config, {
        redirect_uri: redirect.href,
        scope: "openid email",
        response_type: "code",
        state: transaction.state,
        nonce: transaction.nonce,
        code_challenge: createHash("sha256")
          .update(transaction.verifier)
          .digest("base64url"),
        code_challenge_method: "S256",
      });
    },
    async callback(url, transaction) {
      if (
        url.origin !== redirect.origin ||
        url.pathname !== redirect.pathname ||
        url.hash ||
        url.username ||
        url.password
      ) {
        throw new Error("Invalid OIDC callback");
      }
      const tokens = await oidc.authorizationCodeGrant(config, url, {
        pkceCodeVerifier: transaction.verifier,
        expectedState: transaction.state,
        expectedNonce: transaction.nonce,
        idTokenExpected: true,
      });
      const claims = tokens.claims();
      if (
        !claims ||
        claims.iss !== GOOGLE_ISSUER ||
        typeof claims.sub !== "string" ||
        !claims.sub ||
        typeof claims.email !== "string" ||
        !claims.email ||
        claims.email_verified !== true
      ) {
        throw new Error("Invalid Google identity");
      }
      return { issuer: claims.iss, subject: claims.sub, email: claims.email };
    },
  };
}
