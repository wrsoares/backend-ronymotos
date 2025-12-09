// src/middlewares/requireAuth.js
import jwt from "jsonwebtoken";
import { getJwtSecret } from "../config/jwtSecrets.js";

export async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const [, token] = authHeader.split(" ");

    if (!token) {
      return res.status(401).json({ ok: false, error: "Token não informado" });
    }

    const secret = await getJwtSecret();

    const payload = jwt.verify(token, secret); // { id, email, role }
    req.user = payload;

    return next();
  } catch (err) {
    console.error("requireAuth error:", err.message);
    return res.status(401).json({ ok: false, error: "Token inválido ou expirado" });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ ok: false, error: "Não autenticado" });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ ok: false, error: "Acesso negado" });
    }
    return next();
  };
}
