// Extract the signer certificate SHA-256 fingerprint from an APK's
// APK Signing Block (Signature Scheme v2 ID 0x7109871a / v3 ID 0xf05368c0).
// Usage: node extract-apk-cert.mjs <file.apk>
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const file = process.argv[2];
const buf = readFileSync(file);

// Locate the End of Central Directory record (scan back for its signature).
let eocd = -1;
for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66_000); i--) {
  if (buf.readUInt32LE(i) === 0x06054b50) {
    eocd = i;
    break;
  }
}
if (eocd < 0) throw new Error("EOCD not found");
const cdOffset = buf.readUInt32LE(eocd + 16);

// The signing block's magic sits immediately before the central directory.
const magic = buf.subarray(cdOffset - 16, cdOffset).toString("latin1");
if (magic !== "APK Sig Block 42") throw new Error(`No APK signing block (magic=${JSON.stringify(magic)})`);
const blockSize = Number(buf.readBigUInt64LE(cdOffset - 24));

// Walk the ID-value pairs, capturing the signature-scheme ones.
let v2 = null, v3 = null;
{
  let p = cdOffset - blockSize; // first pair starts after the leading size field
  const end = cdOffset - 24;    // trailing size field + magic
  while (p + 12 <= end) {
    const pairLen = Number(buf.readBigUInt64LE(p));
    const id = buf.readUInt32LE(p + 8);
    const value = buf.subarray(p + 12, p + 8 + pairLen);
    if (id === 0x7109871a) v2 = value;
    if (id === 0xf05368c0) v3 = value;
    p += 8 + pairLen;
  }
}

const value = v3 ?? v2;
if (!value) throw new Error("No v2/v3 signature pair found");
const scheme = v3 ? "v3" : "v2";

// Pair value = [signersLen][signers…]; signers = [signerLen][signer…];
// signer = [signedDataLen][signedData…]. The length fields sit at the very
// start, sequentially.
const signedDataLen = value.readUInt32LE(8);
const signedData = value.subarray(12, 12 + signedDataLen);

// signed data = [digestsLen][digests…][certsLen][certs…][attributes…]
const digestsLen = signedData.readUInt32LE(0);
const certsAt = 4 + digestsLen;
const certsLen = signedData.readUInt32LE(certsAt);
const certs = signedData.subarray(certsAt + 4, certsAt + 4 + certsLen);
const certLen = certs.readUInt32LE(0);
const certDer = certs.subarray(4, 4 + certLen);
if (certDer[0] !== 0x30) throw new Error("Extracted certificate is not DER (expected SEQUENCE tag)");
const fp = createHash("sha256").update(certDer).digest("hex").match(/.{2}/g).join(":").toUpperCase();
console.log(JSON.stringify({ file, scheme, certSha256: fp, certBytes: certDer.length }));
