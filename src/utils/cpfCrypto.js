// src/utils/cpfCrypto.js
import crypto from "crypto";

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12; // 96 bits recomendado
const CPF_KEY = process.env.CPF_ENCRYPTION_KEY || "dev-cpf-key-change-me";

// Deriva uma chave de 32 bytes a partir da string da env
const KEY = crypto.createHash("sha256").update(String(CPF_KEY)).digest();

/**
 * Criptografa um CPF (string) e retorna
 * iv:tag:ciphertext em base64
 */
export function encryptCPF(cpf) {
  if (!cpf) return null;

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, KEY, iv);

  let encrypted = cipher.update(cpf, "utf8", "base64");
  encrypted += cipher.final("base64");
  const tag = cipher.getAuthTag();

  return `${iv.toString("base64")}:${tag.toString("base64")}:${encrypted}`;
}

/**
 * Decriptografa o formato iv:tag:ciphertext
 */
export function decryptCPF(payload) {
  if (!payload) return null;

  const [ivB64, tagB64, encB64] = payload.split(":");
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");

  const decipher = crypto.createDecipheriv(ALGO, KEY, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encB64, "base64", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

/**
 * Retorna só os 4 últimos dígitos (para cpf_last4)
 */
export function extractLast4(cpf) {
  const digits = cpf.replace(/\D/g, "");
  return digits.slice(-4).padStart(4, "0");
}
