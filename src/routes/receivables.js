// src/routes/receivables.js
import express from "express";
import { pool } from "../config/db.js";
import { requireAuth, requireRole } from "../middlewares/requireAuth.js";

const router = express.Router();
router.use(requireAuth, requireRole("admin"));

// Lista contas a receber (opcional filtro por status)
router.get("/", async (req, res) => {
  const { status } = req.query;
  try {
    const params = [];
    let where = "";
    if (status) {
      params.push(status);
      where = "WHERE status = $1";
    }
    const { rows } = await pool.query(
      `
        SELECT id, title, amount, due_date, status, notes, plate, customer_name, received_at, created_at, updated_at
        FROM receivables
        ${where}
        ORDER BY due_date ASC, created_at DESC
      `,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error("Erro ao listar receivables", err);
    res.status(500).json({ error: "Erro ao listar contas a receber" });
  }
});

// Cria conta a receber
router.post("/", async (req, res) => {
  const { title, amount, due_date, notes, plate, customer_name } = req.body;

  if (!title || !amount || !due_date) {
    return res.status(400).json({ error: "title, amount e due_date são obrigatórios." });
  }

  try {
    const { rows } = await pool.query(
      `
        INSERT INTO receivables (title, amount, due_date, status, notes, plate, customer_name)
        VALUES ($1, $2, $3, 'pending', $4, $5, $6)
        RETURNING id, title, amount, due_date, status, notes, plate, customer_name, received_at, created_at, updated_at
      `,
      [title, amount, due_date, notes || null, plate || null, customer_name || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("Erro ao criar receivable", err);
    res.status(500).json({ error: "Erro ao criar conta a receber" });
  }
});

// Atualiza conta a receber
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const { title, amount, due_date, status, notes, plate, customer_name } = req.body;

  try {
    const { rows, rowCount } = await pool.query(
      `
        UPDATE receivables
        SET
          title = COALESCE($1, title),
          amount = COALESCE($2, amount),
          due_date = COALESCE($3, due_date),
          status = COALESCE($4, status),
          notes = COALESCE($5, notes),
          plate = COALESCE($6, plate),
          customer_name = COALESCE($7, customer_name),
          updated_at = NOW()
        WHERE id = $8
        RETURNING id, title, amount, due_date, status, notes, plate, customer_name, received_at, created_at, updated_at
      `,
      [title, amount, due_date, status, notes, plate, customer_name, id]
    );

    if (!rowCount) return res.status(404).json({ error: "Conta não encontrada" });
    res.json(rows[0]);
  } catch (err) {
    console.error("Erro ao atualizar receivable", err);
    res.status(500).json({ error: "Erro ao atualizar conta a receber" });
  }
});

// Marca como recebida
router.patch("/:id/receive", async (req, res) => {
  const { id } = req.params;
  try {
    const { rows, rowCount } = await pool.query(
      `
        UPDATE receivables
        SET status = 'paid', received_at = NOW(), updated_at = NOW()
        WHERE id = $1
        RETURNING id, title, amount, due_date, status, notes, plate, customer_name, received_at, created_at, updated_at
      `,
      [id]
    );
    if (!rowCount) return res.status(404).json({ error: "Conta não encontrada" });
    res.json(rows[0]);
  } catch (err) {
    console.error("Erro ao registrar recebimento", err);
    res.status(500).json({ error: "Erro ao registrar recebimento" });
  }
});

export default router;
