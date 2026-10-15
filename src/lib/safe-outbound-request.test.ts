import assert from "node:assert/strict";
import { before, beforeEach, mock, test } from "node:test";
import { EventEmitter } from "node:events";
import type { RequestOptions, IncomingMessage } from "node:http";

let addresses = [{ address: "93.184.216.34", family: 4 }];
let dnsCalls = 0;
let requests = 0;
let status = 204;
let hangDns = false;
let hangBody = false;
let responseBytes = 0;
let drained = false;
let destroyed = false;
let optionsSeen: RequestOptions;
let connectedAddress = "";
let allLookup = false;
mock.module("node:dns", { namedExports: {
  lookup: (_host: string, _options: unknown, cb: (err: null, result: typeof addresses) => void) => {
    dnsCalls++;
    if (!hangDns) queueMicrotask(() => cb(null, addresses));
  },
} });
function request(_url: URL, options: RequestOptions, onResponse: (res: IncomingMessage) => void) {
  requests++;
  optionsSeen = options;
  const req = Object.assign(new EventEmitter(), {
    destroy: () => { destroyed = true; },
    end: () => {
      const connected = () => {
        const res = Object.assign(new EventEmitter(), {
          statusCode: status,
          destroy: () => { destroyed = true; },
          resume: () => {
            drained = true;
            queueMicrotask(() => {
              if (responseBytes) res.emit("data", Buffer.alloc(responseBytes));
              if (!hangBody) res.emit("end");
            });
          },
        });
        onResponse(res as unknown as IncomingMessage);
      };
      options.lookup!("hooks.example", { all: allLookup }, (err, address) => {
        if (err) req.emit("error", err);
        else { connectedAddress = String(address); connected(); }
      });
    },
  });
  return req;
}
mock.module("node:http", { namedExports: { request } });
mock.module("node:https", { namedExports: { request } });
let post: typeof import("./safe-outbound-request").safeOutboundPost;
let publicAddress: typeof import("./safe-outbound-request").isPublicOutboundAddress;
before(async () => {
  const helper = await import("./safe-outbound-request");
  post = helper.safeOutboundPost;
  publicAddress = helper.isPublicOutboundAddress;
});
beforeEach(() => {
  addresses = [{ address: "93.184.216.34", family: 4 }];
  dnsCalls = requests = responseBytes = 0;
  status = 204;
  hangDns = hangBody = drained = destroyed = false;
  connectedAddress = "";
  allLookup = false;
});

test("pins validated DNS to the actual socket lookup, no second resolution or pooled socket", async () => {
  await post("https://hooks.example/private?token=secret", "{}", {});
  assert.equal(dnsCalls, 1);
  assert.equal(connectedAddress, "93.184.216.34");
  assert.equal(optionsSeen.agent, false);
  assert.equal(drained, true);
});
test("validates every connection attempt when DNS changes from public to private", async () => {
  await post("https://hooks.example", "{}", {});
  addresses = [{ address: "127.0.0.1", family: 4 }];
  connectedAddress = "";
  await assert.rejects(post("https://hooks.example", "{}", {}));
  assert.equal(connectedAddress, "");
  assert.equal(dnsCalls, 2);
});
test("supports Node auto-family lookup with only the validated DNS snapshot", async () => {
  allLookup = true;
  await post("https://hooks.example", "{}", {});
  assert.equal(dnsCalls, 1);
  addresses = [{ address: "::1", family: 6 }];
  await assert.rejects(post("https://hooks.example", "{}", {}));
});
test("rejects private, mapped and mixed DNS answers before connecting", async () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "::ffff:127.0.0.1", "fc00::1", "64:ff9b::7f00:1"]) {
    addresses = [{ address: "93.184.216.34", family: 4 }, { address, family: address.includes(":") ? 6 : 4 }];
    await assert.rejects(post("https://hooks.example", "{}", {}), /^Error: Outbound request failed$/);
    assert.equal(connectedAddress, "");
  }
});
test("rejects unsafe literals, credentials and protocols without DNS/network", async () => {
  for (const url of ["http://2130706433", "http://[::ffff:7f00:1]", "http://169.254.169.254", "https://user:secret@example.com", "file:///tmp/x"]) {
    await assert.rejects(post(url, "{}", {}));
  }
  assert.equal(requests, 0);
  assert.equal(dnsCalls, 0);
});
test("drains redirects but never follows Location", async () => {
  status = 302;
  await assert.rejects(post("https://hooks.example", "{}", {}));
  assert.equal(requests, 1);
  assert.equal(drained, true);
});
test("deadline includes DNS and response body; destroys stalled requests", async () => {
  hangDns = true;
  await assert.rejects(post("https://hooks.example", "{}", {}, 10));
  assert.equal(destroyed, true);
  hangDns = false;
  hangBody = true;
  destroyed = false;
  await assert.rejects(post("https://hooks.example", "{}", {}, 10));
  assert.equal(drained, true);
  assert.equal(destroyed, true);
});
test("bounds response drain bytes", async () => {
  responseBytes = 1_048_577;
  await assert.rejects(post("https://hooks.example", "{}", {}));
  assert.equal(destroyed, true);
});
test("public address policy excludes transition and reserved networks", () => {
  for (const address of ["0.0.0.0", "100.64.0.1", "192.0.0.1", "198.18.0.1", "224.0.0.1", "::", "fe80::1", "2002:7f00:1::", "2001::1", "2001:db8::1"]) assert.equal(publicAddress(address), false, address);
  assert.equal(publicAddress("2606:4700:4700::1111"), true);
});
