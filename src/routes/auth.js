import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "../config/db.js";
import { getJwtSecret } from "../config/jwtSecrets.js";
import { requireAuth } from "../middlewares/requireAuth.js";

const router = express.Router();

// Tempo dos tokens
const ACCESS_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES || "15m";
const REFRESH_EXPIRES_DAYS = 7;

// Gera access token
async function signAccessToken(user) {
  const secret = await getJwtSecret();
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role
    },
    secret,
    { expiresIn: ACCESS_EXPIRES_IN }
  );
}

// Gera refresh token (string aleatória)
function generateRefreshTokenString() {
  return [...Array(60)]
    .map(() => Math.random().toString(36)[2])
    .join("");
}

// Salva refresh token no banco
async function storeRefreshToken(userId, token, req) {
  const expiresAt = new Date(Date.now() + REFRESH_EXPIRES_DAYS * 86400000);

  await pool.query(
    `
    INSERT INTO user_refresh_tokens
      (user_id, refresh_token, user_agent, ip_address, expires_at)
    VALUES ($1, $2, $3, $4, $5)
    `,
    [userId, token, req.headers["user-agent"], req.ip, expiresAt]
  );
}

// ==========================================================================
// REGISTER
// ==========================================================================
router.post("/register", async (req, res) => {
  try {
    const { name, email, password, role = "user" } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ ok: false, error: "Campos obrigatórios." });
    }

    const exists = await pool.query("SELECT 1 FROM users WHERE email = $1", [
      email
    ]);

    if (exists.rows.length) {
      return res.status(409).json({ ok: false, error: "E-mail já cadastrado." });
    }

    const hash = await bcrypt.hash(password, 10);

    const { rows } = await pool.query(
      `
      INSERT INTO users (name, email, password_hash, role)
      VALUES ($1,$2,$3,$4)
      RETURNING id, name, email, role, created_at
      `,
      [name, email, hash, role]
    );

    res.status(201).json({ ok: true, user: rows[0] });
  } catch (err) {
    console.error("REGISTER error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ==========================================================================
// LOGIN
// ==========================================================================
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const { rows } = await pool.query(
      `SELECT * FROM users WHERE email = $1 LIMIT 1`,
      [email]
    );

    if (!rows.length)
      return res.status(401).json({ ok: false, error: "Credenciais inválidas." });

    const user = rows[0];

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid)
      return res.status(401).json({ ok: false, error: "Credenciais inválidas." });

    // ACCESS TOKEN
    const accessToken = await signAccessToken(user);

    // REFRESH TOKEN
    const refreshToken = generateRefreshTokenString();
    await storeRefreshToken(user.id, refreshToken, req);

    res.json({
      ok: true,
      access_token: accessToken,
      refresh_token: refreshToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (err) {
    console.error("LOGIN error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ==========================================================================
// REFRESH
// ==========================================================================
router.post("/refresh", async (req, res) => {
  try {
    const { refresh_token } = req.body;

    if (!refresh_token)
      return res.status(400).json({ ok: false, error: "Refresh token ausente." });

    // procura refresh token no banco
    const { rows } = await pool.query(
      `
      SELECT urt.*, u.email, u.role
      FROM user_refresh_tokens urt
      JOIN users u ON u.id = urt.user_id
      WHERE refresh_token = $1
      `,
      [refresh_token]
    );

    if (!rows.length)
      return res.status(401).json({ ok: false, error: "Refresh token inválido." });

    const session = rows[0];

    // verifica expiração
    if (new Date(session.expires_at) < new Date()) {
      return res.status(401).json({ ok: false, error: "Refresh token expirado." });
    }

    // gera novo access token
    const newAccess = await signAccessToken({
      id: session.user_id,
      email: session.email,
      role: session.role
    });

    res.json({
      ok: true,
      access_token: newAccess
    });
  } catch (err) {
    console.error("REFRESH error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ==========================================================================
// LOGOUT
// ==========================================================================
router.post("/logout", requireAuth, async (req, res) => {
  try {
    const { refresh_token } = req.body;

    if (!refresh_token)
      return res
        .status(400)
        .json({ ok: false, error: "Informe o refresh_token." });

    await pool.query(
      `DELETE FROM user_refresh_tokens WHERE refresh_token = $1`,
      [refresh_token]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error("LOGOUT error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ==========================================================================
// ME
// ==========================================================================
router.get("/me", requireAuth, async (req, res) => {
  try {
    const { id } = req.user;
    const { rows } = await pool.query(
      `SELECT id, name, email, role, created_at FROM users WHERE id = $1`,
      [id]
    );
    res.json({ ok: true, user: rows[0] });
  } catch (err) {
    console.error("ME error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
