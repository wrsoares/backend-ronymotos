// src/config/jwtSecrets.js
import "dotenv/config";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const secretsClient = new SecretsManagerClient({
  region: process.env.AWS_REGION || "us-east-1",
});

let cachedSecret = null;

export async function getJwtSecret() {
  if (cachedSecret) return cachedSecret;

  const secretId = process.env.JWT_SECRET_ID;
  if (!secretId) {
    throw new Error("JWT_SECRET_ID não definido no .env");
  }

  const resp = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: secretId })
  );

  const secretJson = JSON.parse(resp.SecretString || "{}");

  if (!secretJson.JWT_SECRET) {
    throw new Error("JWT_SECRET não encontrado no Secrets Manager");
  }

  cachedSecret = secretJson.JWT_SECRET;
  return cachedSecret;
}
