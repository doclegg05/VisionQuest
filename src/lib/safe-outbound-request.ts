import { lookup } from "node:dns";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";

// Webhook-only policy. Do not apply this to locally configured AI providers.
const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24],
  ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3],
] as const) blocked.addSubnet(address, prefix, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
for (const [address, prefix] of [["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]] as const) {
  blocked.addSubnet(address, prefix, "ipv6");
}

export function isPublicOutboundAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, "ipv4");
  // Refuse mapped/translated IPv4 and transition mechanisms, not just loopback.
  return family === 6 && globalV6.check(address, "ipv6") && !blocked.check(address, "ipv6");
}

const failure = () => new Error("Outbound request failed");

/**
 * POST to a public endpoint. Node's request never follows redirects. The socket's
 * own lookup returns ONLY validated IPs, with no second DNS lookup (rebinding).
 * Original hostname is retained for Host, TLS SNI and certificate verification.
 * No reusable agent/proxy socket can bypass validation. Errors contain no URL.
 */
export async function safeOutboundPost(
  target: string,
  body: string,
  headers: Record<string, string>,
  deadlineMs = 10_000,
): Promise<void> {
  let url: URL;
  try { url = new URL(target); } catch { throw failure(); }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!(["http:", "https:"].includes(url.protocol)) || url.username || url.password ||
      (isIP(host) && !isPublicOutboundAddress(host)) ||
      !Number.isFinite(deadlineMs) || deadlineMs <= 0) throw failure();

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let response: IncomingMessage | undefined;
    let request: ReturnType<typeof httpRequest> | undefined;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!ok) {
        response?.destroy();
        request?.destroy();
        reject(failure());
      } else resolve();
    };
    const timer = setTimeout(() => finish(false), Math.min(deadlineMs, 10_000));
    const pinnedLookup: LookupFunction = (hostname, options, callback) => {
      lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
        if (settled || error || !addresses?.length ||
            addresses.some(({ address }) => !isPublicOutboundAddress(address))) {
          callback(failure(), "", 4);
          return;
        }
        // Support both Node lookup modes, returning the same validated snapshot.
        if (options.all) callback(null, addresses);
        else callback(null, addresses[0].address, addresses[0].family);
      });
    };
    try {
      request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
        method: "POST", headers, agent: false, lookup: pinnedLookup,
      }, (res) => {
        response = res;
        let bytes = 0;
        res.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 1_048_576) finish(false);
        });
        res.on("error", () => finish(false));
        res.on("aborted", () => finish(false));
        res.on("end", () => finish((res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300));
        // Drain even unsuccessful/redirect responses; bound bytes and total time.
        res.resume();
      });
      request.on("error", () => finish(false));
      request.end(body);
    } catch { finish(false); }
  });
}
