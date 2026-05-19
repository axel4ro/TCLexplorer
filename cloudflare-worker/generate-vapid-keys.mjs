import { generateKeyPairSync } from "node:crypto";

function base64UrlFromBuffer(buffer) {
  return Buffer.from(buffer)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

const { publicKey, privateKey } = generateKeyPairSync("ec", {
  namedCurve: "prime256v1"
});

const publicJwk = publicKey.export({ format: "jwk" });
const privateJwk = privateKey.export({ format: "jwk" });
const x = Buffer.from(publicJwk.x, "base64url");
const y = Buffer.from(publicJwk.y, "base64url");
const publicRaw = Buffer.concat([Buffer.from([0x04]), x, y]);

console.log(JSON.stringify({
  publicKey: base64UrlFromBuffer(publicRaw),
  privateKey: privateJwk.d
}, null, 2));
