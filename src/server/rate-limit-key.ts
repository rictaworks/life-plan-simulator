import type { Request } from "express";
import { ipKeyGenerator } from "express-rate-limit";
import { isIP } from "node:net";

export type RateLimitIpSource = "socket" | "railway-edge";

/** Opt-in applies only to rate limiting, never Express host/protocol or auth.
 * Railway mode requires edge-only public ingress and trusted private peers.
 * Headers alone cannot authenticate the edge; see ENV/PRODUCTION.md.
 */
export function rateLimitKey(
  request: Pick<Request, "headers" | "rawHeaders" | "socket">,
  source: RateLimitIpSource,
): string {
  const peer = request.socket.remoteAddress;
  let ip = peer && isIP(peer) ? peer : undefined;
  if (source === "railway-edge") {
    const value = request.headers["x-real-ip"];
    let occurrences = 0;
    for (let i = 0; i < request.rawHeaders.length; i += 2)
      if (request.rawHeaders[i]?.toLowerCase() === "x-real-ip") occurrences++;
    if (
      occurrences === 1 &&
      typeof value === "string" &&
      !value.includes("%") &&
      isIP(value)
    )
      ip = value;
  }
  // The library normalizes mapped IPv4 and aggregates native IPv6 to /56.
  // Missing/invalid assertions never create attacker-selected fallback buckets.
  return ip ? ipKeyGenerator(ip) : "unknown-peer";
}
