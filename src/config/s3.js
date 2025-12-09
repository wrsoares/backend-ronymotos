// src/config/s3.js
import "dotenv/config";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const region = process.env.AWS_REGION || "us-east-1";
const bucket = process.env.S3_BUCKET_RONYMOTOS;

if (!bucket) {
  console.warn("[S3] Variável S3_BUCKET_RONYMOTOS não definida.");
}

export const s3Client = new S3Client({
  region,
  // credenciais virão da IAM Role da EC2 (melhor prática)
});

/**
 * Faz upload de um buffer para o S3.
 * @param {Buffer} buffer
 * @param {string} key
 * @param {string} contentType
 * @returns {Promise<string>} URL pública do arquivo
 */
export async function uploadBufferToS3(buffer, key, contentType) {
  if (!bucket) {
    throw new Error("Bucket S3 não configurado (S3_BUCKET_RONYMOTOS).");
  }

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    ACL: "public-read" // se quiser objetos públicos direto
  });

  await s3Client.send(command);

  // Monta URL pública
  const baseUrl = process.env.S3_PUBLIC_BASE_URL?.trim();
  if (baseUrl) {
    return `${baseUrl.replace(/\/$/, "")}/${key}`;
  }

  // URL padrão do S3
  return `https://${bucket}.s3.${region}.amazonaws.com/${encodeURIComponent(
    key
  )}`;
}
