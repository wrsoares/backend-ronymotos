// src/routes/auth.js
import express from "express";
import bcrypt from "bcryptjs";
import { pool } from "../config/db.js";
import { getJwtSecret } from "../config/jwtSecrets.js";
import { requireAuth, requireRole } from "../middlewares/requireAuth.js";

const router = express.Router();
const SALT_ROUNDS = 10;

// Util para gerar token
async function signToken(user) {
  const secret = await getJwtSecret();
  const expiresIn = process.env.JWT_EXPIRES_IN || "1d";

  return new Promise((resolve, reject) => {
    jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
      },
      secret,
      { expiresIn },
      (err, token) => (err ? reject(err) : resolve(token))
    );
  });
}

/**
 * POST /auth/register
 * - cria usuário
 * - por padrão role = "user"
 * - para criar admin, enviar { role: "admin" } (idealmente restringir depois)
 */
router.post("/register", async (req, res) => {
  try {
    const { name, email, password, role = "user" } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ ok: false, error: "Nome, e-mail e senha são obrigatórios." });
    }

    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ ok: false, error: "E-mail já cadastrado." });
    }

    const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

    const { rows } = await pool.query(
      `
      INSERT INTO users (name, email, password_hash, role)
      VALUES ($1, $2, $3, $4)
      RETURNING id, name, email, role, created_at;
      `,
      [name, email, password_hash, role]
    );

    const user = rows[0];

    res.status(201).json({
      ok: true,
      user,
    });
  } catch (err) {
    console.error("POST /auth/register error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /auth/login
 * body: { email, password }
 * resposta: { ok, token, user }
 */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ ok: false, error: "E-mail e senha são obrigatórios." });
    }

    const { rows } = await pool.query(
      "SELECT id, name, email, password_hash, role, is_active FROM users WHERE email = $1",
      [email]
    );

    if (!rows.length) {
      return res.status(401).json({ ok: false, error: "Credenciais inválidas." });
    }

    const user = rows[0];

    if (!user.is_active) {
      return res.status(403).json({ ok: false, error: "Usuário inativo." });
    }

    const passwordOk = await bcrypt.compare(password, user.password_hash);
    if (!passwordOk) {
      return res.status(401).json({ ok: false, error: "Credenciais inválidas." });
    }

    const token = await signToken(user);

    res.json({
      ok: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("POST /auth/login error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /auth/me
 * - retorna dados do usuário autenticado
 */
router.get("/me", requireAuth, async (req, res) => {
  try {
    const { id } = req.user;

    const { rows } = await pool.query(
      "SELECT id, name, email, role, is_active, created_at FROM users WHERE id = $1",
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({ ok: false, error: "Usuário não encontrado." });
    }

    res.json({ ok: true, user: rows[0] });
  } catch (err) {
    console.error("GET /auth/me error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
