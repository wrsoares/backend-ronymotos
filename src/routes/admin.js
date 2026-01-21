// src/routes/admin.js
import express from "express";
import bcrypt from "bcryptjs";
import { pool } from "../config/db.js";
import { requireAuth, requireRole } from "../middlewares/requireAuth.js";

const router = express.Router();

// Todas as rotas deste módulo exigem admin
router.use(requireAuth, requireRole("admin"));

const CONSULTA_URL = "https://api.consultarplaca.com.br/v2/solicitarRelatorio";
const PROTOCOLO_URL = "https://api.consultarplaca.com.br/v2/consultarProtocolo";
const BASIC_AUTH =
  "Basic YW1hbmRhY29lbGhvYnJhQGdtYWlsLmNvbTo5ZTNhZjUxYzk0NTY2NWVjOTNiOTA2MDczMDU4MjJlYw==";

// GET /admin/search/plate?plate=XXX&type=bronze|prata|ouro|diamante|personalizada
router.get("/search/plate", async (req, res) => {
  const { plate = "", type = "" } = req.query;

  const allowedTypes = ["bronze", "prata", "ouro", "diamante", "personalizada"];
  if (!allowedTypes.includes(String(type).toLowerCase())) {
    return res.status(400).json({ error: "Tipo inválido. Use bronze, prata, ouro, diamante ou personalizada." });
  }

  const normalizedPlate = String(plate).trim().toLowerCase();
  if (!normalizedPlate) {
    return res.status(400).json({ error: "Parâmetro plate é obrigatório." });
  }

  try {
    const { rows } = await pool.query(
      `
        SELECT
          v.id,
          v.brand,
          v.model,
          v.year,
          v.plate,
          v.status,
          v.price,
          v.created_at
        FROM vehicles v
        WHERE v.deleted_at IS NULL
          AND LOWER(v.plate) LIKE $1
        ORDER BY v.created_at DESC
        LIMIT 20;
      `,
      [`%${normalizedPlate}%`]
    );

    return res.json({
      type: type.toLowerCase(),
      results: rows,
    });
  } catch (err) {
    console.error("Erro na busca por placa", err);
    return res.status(500).json({ error: "Erro ao buscar por placa." });
  }
});

// POST /admin/plate/consult - chama API externa para solicitar relatório
router.post("/plate/consult", async (req, res) => {
  const { placa, tipo_consulta, consulta_para_revenda = "0" } = req.body;

  const allowedTypes = ["bronze", "prata", "ouro", "diamante", "personalizada"];
  if (!allowedTypes.includes(String(tipo_consulta).toLowerCase())) {
    return res.status(400).json({ error: "tipo_consulta inválido." });
  }
  if (!placa) return res.status(400).json({ error: "placa é obrigatória." });

  try {
    const form = new FormData();
    form.append("placa", placa);
    form.append("tipo_consulta", tipo_consulta);
    form.append("consulta_para_revenda", String(consulta_para_revenda));

    const resp = await fetch(CONSULTA_URL, {
      method: "POST",
      headers: { Authorization: BASIC_AUTH },
      body: form,
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      await pool.query(
        `
          INSERT INTO plate_queries (plate, tipo_consulta, status, raw_response)
          VALUES ($1,$2,$3,$4)
        `,
        [placa, String(tipo_consulta).toLowerCase(), "erro", data || {}]
      );
      return res.status(resp.status).json({ error: data?.mensagem || "Erro na consulta externa" });
    }

    await pool.query(
      `
        INSERT INTO plate_queries (plate, tipo_consulta, protocolo, link_resultado, status, raw_response)
        VALUES ($1,$2,$3,$4,$5,$6)
      `,
      [
        placa,
        String(tipo_consulta).toLowerCase(),
        data?.protocolo || null,
        data?.link_resultado || null,
        data?.status || "em_processamento",
        data || {}
      ]
    );

    return res.json(data);
  } catch (err) {
    console.error("Erro ao consultar placa externamente", err);
    return res.status(500).json({ error: "Erro ao consultar placa." });
  }
});

// ==========================================================================
// USERS (ADMIN)
// ==========================================================================
router.get("/users", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `
      SELECT id, name, username, email, phone, role, is_active, created_at
      FROM users
      ORDER BY created_at DESC
      `
    );

    return res.json({ ok: true, users: rows });
  } catch (err) {
    console.error("GET /admin/users error:", err);
    return res.status(500).json({ ok: false, error: "Erro ao listar usuários." });
  }
});

router.post("/users", async (req, res) => {
  try {
    const { name, username, email, phone, password, role = "user" } = req.body;

    if (!name || !username || !password) {
      return res
        .status(400)
        .json({ ok: false, error: "Nome, username e senha são obrigatórios." });
    }

    const existsUsername = await pool.query(
      "SELECT 1 FROM users WHERE username = $1",
      [username]
    );
    if (existsUsername.rows.length) {
      return res.status(409).json({ ok: false, error: "Username já está em uso." });
    }

    if (phone) {
      const existsPhone = await pool.query(
        "SELECT 1 FROM users WHERE phone = $1",
        [phone]
      );
      if (existsPhone.rows.length) {
        return res.status(409).json({ ok: false, error: "Telefone já está em uso." });
      }
    }

    const hash = await bcrypt.hash(password, 10);

    const { rows } = await pool.query(
      `
      INSERT INTO users (name, username, email, phone, password_hash, role)
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING id, name, username, email, phone, role, is_active, created_at
      `,
      [name, username, email || null, phone || null, hash, role]
    );

    return res.status(201).json({ ok: true, user: rows[0] });
  } catch (err) {
    console.error("POST /admin/users error:", err);
    return res.status(500).json({ ok: false, error: "Erro ao criar usuário." });
  }
});

router.patch("/users/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { is_active } = req.body;

    if (typeof is_active !== "boolean") {
      return res.status(400).json({ ok: false, error: "is_active inválido." });
    }

    const { rows } = await pool.query(
      `
      UPDATE users
      SET is_active = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id, name, username, email, phone, role, is_active, created_at
      `,
      [is_active, id]
    );

    if (!rows.length) {
      return res.status(404).json({ ok: false, error: "Usuário não encontrado." });
    }

    return res.json({ ok: true, user: rows[0] });
  } catch (err) {
    console.error("PATCH /admin/users/:id/status error:", err);
    return res.status(500).json({ ok: false, error: "Erro ao atualizar usuário." });
  }
});

// GET /admin/plate/download?protocolo=... ou link=...
router.get("/plate/download", async (req, res) => {
  const { protocolo, link } = req.query;
  const url =
    link ||
    (protocolo ? `${PROTOCOLO_URL}?protocolo=${encodeURIComponent(protocolo)}` : null);
  if (!url) return res.status(400).json({ error: "Informe protocolo ou link." });

  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: { Authorization: BASIC_AUTH },
    });
    const contentType = resp.headers.get("content-type") || "";

    // Se for JSON, repassa como JSON (status: em_processamento, parcialmente_finalizada, finalizada, etc.)
    if (contentType.includes("application/json")) {
      const data = await resp.json().catch(() => ({}));
      const status = data?.status || data?.situacao || "em_processamento";
      const protocoloToUpdate = protocolo || data?.protocolo || null;
      const urlPdf = data?.dados?.url_pdf || null;
      if (protocoloToUpdate) {
        await pool.query(
          `
            UPDATE plate_queries
            SET status = $1,
                raw_response = $2,
                link_resultado = COALESCE($4, link_resultado),
                updated_at = NOW()
            WHERE protocolo = $3
          `,
          [status, data || {}, protocoloToUpdate, urlPdf]
        );
      }
      return res.status(resp.status).json(data);
    }

    // Caso contrário, assume PDF/binary
    if (!resp.ok) {
      return res.status(resp.status).json({ error: "Erro ao baixar relatório externo" });
    }

    const buffer = Buffer.from(await resp.arrayBuffer());
    if (protocolo) {
      await pool.query(
        `
          UPDATE plate_queries
          SET status = 'finalizada', updated_at = NOW()
          WHERE protocolo = $1
        `,
        [protocolo]
      );
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=relatorio.pdf");
    return res.send(buffer);
  } catch (err) {
    console.error("Erro ao baixar relatório", err);
    return res.status(500).json({ error: "Erro ao baixar relatório." });
  }
});

// GET /admin/plate/history - lista histórico de consultas
router.get("/plate/history", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `
        SELECT id, plate, tipo_consulta, protocolo, link_resultado, status, created_at, updated_at
        FROM plate_queries
        ORDER BY created_at DESC
        LIMIT 100;
      `
    );
    res.json(rows);
  } catch (err) {
    console.error("Erro ao listar histórico de consultas", err);
    res.status(500).json({ error: "Erro ao listar histórico" });
  }
});

export default router;
