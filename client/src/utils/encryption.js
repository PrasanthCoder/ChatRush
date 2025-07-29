import {
  arrayBufferToBase64,
  base64ToArrayBuffer,
} from "./formatConvertions.js";

export async function generateKeyPair() {
  try {
    if (!window.crypto || !window.crypto.subtle) {
      throw new Error("Web Crypto API not supported in this browser.");
    }
    console.log(
      "Generating key pair, Protocol:",
      window.location.protocol,
      "Host:",
      window.location.host,
      "SecureContext:",
      window.isSecureContext
    );
    const keyPair = await window.crypto.subtle.generateKey(
      {
        name: "RSA-OAEP",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["encrypt", "decrypt"]
    );
    console.log(
      "Key pair generated successfully:",
      !!keyPair.publicKey,
      !!keyPair.privateKey
    );
    return { success: true, keyPair: keyPair };
  } catch (err) {
    console.error("Key generation failed:", err.message);
    return {
      success: false,
      error:
        "Encryption: Failed to set up keys. Use a local IP (e.g., 192.168.1.x) or enable HTTPS.",
    };
  }
}

export async function exportPublicKey(publicKey) {
  console.log("Entering exportPublicKey");
  if (!publicKey) {
    console.error("Public key is null or undefined");
    throw new Error("Cannot export null public key");
  }
  const exported = await window.crypto.subtle.exportKey("spki", publicKey);
  console.log("Public key exported successfully");
  return arrayBufferToBase64(exported);
}

export async function importPublicKey(base64Key) {
  const binaryKey = base64ToArrayBuffer(base64Key);
  return await window.crypto.subtle.importKey(
    "spki",
    binaryKey,
    { name: "RSA-OAEP", hash: "SHA-256" },
    true,
    ["encrypt"]
  );
}

export async function generateSymmetricKey() {
  try {
    return await window.crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"]
    );
  } catch (err) {
    console.error("Symmetric key generation failed:", err);
    return null;
  }
}

export async function exportSymmetricKey(key) {
  const exported = await window.crypto.subtle.exportKey("raw", key);
  return arrayBufferToBase64(exported);
}

export async function importSymmetricKey(base64Key) {
  const binaryKey = base64ToArrayBuffer(base64Key);
  return await window.crypto.subtle.importKey(
    "raw",
    binaryKey,
    { name: "AES-GCM" },
    true,
    ["encrypt", "decrypt"]
  );
}

export async function encryptMessageRSA(message, publicKey) {
  const encoded = new TextEncoder().encode(message);
  const encrypted = await window.crypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    publicKey,
    encoded
  );
  return arrayBufferToBase64(encrypted);
}

export async function encryptMessageAES(message, symmetricKey) {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(message);
  const encrypted = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    symmetricKey,
    encoded
  );
  const encryptedBase64 = arrayBufferToBase64(encrypted);
  return { encrypted: encryptedBase64, iv: arrayBufferToBase64(iv) };
}

export async function decryptMessageRSA(encrypted, privateKey) {
  try {
    const data = base64ToArrayBuffer(encrypted);
    const decrypted = await window.crypto.subtle.decrypt(
      { name: "RSA-OAEP" },
      privateKey,
      data
    );
    return new TextDecoder().decode(decrypted);
  } catch (err) {
    console.error("Decryption failed:", err);
    return "[Failed to decrypt message]";
  }
}

export async function decryptMessageAES(
  encryptedBase64,
  ivBase64,
  symmetricKey
) {
  try {
    const iv = base64ToArrayBuffer(ivBase64);
    const data = base64ToArrayBuffer(encryptedBase64);
    const decrypted = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      symmetricKey,
      data
    );
    return new TextDecoder().decode(decrypted);
  } catch (err) {
    console.error("AES decryption failed:", err);
    return "[Failed to decrypt message]";
  }
}
