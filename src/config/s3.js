// src/config/s3.js
import "dotenv/config";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

const region = process.env.AWS_REGION || "us-east-1";
const bucket = process.env.S3_BUCKET_RONYMOTOS;

if (!bucket) {
  console.warn("[S3] Variável S3_BUCKET_RONYMOTOS não definida.");
}

export const s3Client = new S3Client({
  region,
  // credenciais vêm da IAM Role da EC2
});

/**
 * Faz upload de um buffer para o S3.
 * Retorna SOMENTE a key armazenada no bucket.
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
    // ❌ nada de ACL aqui, bucket continua privado
  });

  await s3Client.send(command);

  // Em vez de URL pública, devolvemos só a key
  return key;
}

/**
 * Obtém o objeto do S3 para streaming.
 */
export async function getObjectFromS3(key) {
  if (!bucket) {
    throw new Error("Bucket S3 não configurado (S3_BUCKET_RONYMOTOS).");
  }

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key
  });

  const resp = await s3Client.send(command);
  // resp.Body é um ReadableStream (Node.js Readable)
  return {
    stream: resp.Body,
    contentType: resp.ContentType || "application/octet-stream"
  };
}
