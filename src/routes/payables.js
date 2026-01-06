// src/routes/payables.js
import express from "express";
import { pool } from "../config/db.js";
import { requireAuth, requireRole } from "../middlewares/requireAuth.js";

const router = express.Router();
router.use(requireAuth, requireRole("admin"));

// Lista contas (opcional filtro por status)
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
        SELECT id, title, amount, due_date, status, notes, paid_at, created_at, updated_at
        FROM payables
        ${where}
        ORDER BY due_date ASC, created_at DESC
      `,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error("Erro ao listar payables", err);
    res.status(500).json({ error: "Erro ao listar contas a pagar" });
  }
});

// Cria conta a pagar
router.post("/", async (req, res) => {
  const { title, amount, due_date, notes } = req.body;

  if (!title || !amount || !due_date) {
    return res.status(400).json({ error: "title, amount e due_date são obrigatórios." });
  }

  try {
    const { rows } = await pool.query(
      `
        INSERT INTO payables (title, amount, due_date, status, notes)
        VALUES ($1, $2, $3, 'pending', $4)
        RETURNING id, title, amount, due_date, status, notes, paid_at, created_at, updated_at
      `,
      [title, amount, due_date, notes || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("Erro ao criar payable", err);
    res.status(500).json({ error: "Erro ao criar conta a pagar" });
  }
});

// Atualiza conta a pagar
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const { title, amount, due_date, status, notes } = req.body;

  try {
    const { rows, rowCount } = await pool.query(
      `
        UPDATE payables
        SET
          title = COALESCE($1, title),
          amount = COALESCE($2, amount),
          due_date = COALESCE($3, due_date),
          status = COALESCE($4, status),
          notes = COALESCE($5, notes),
          updated_at = NOW()
        WHERE id = $6
        RETURNING id, title, amount, due_date, status, notes, paid_at, created_at, updated_at
      `,
      [title, amount, due_date, status, notes, id]
    );

    if (!rowCount) return res.status(404).json({ error: "Conta não encontrada" });
    res.json(rows[0]);
  } catch (err) {
    console.error("Erro ao atualizar payable", err);
    res.status(500).json({ error: "Erro ao atualizar conta a pagar" });
  }
});

// Marca como pago
router.patch("/:id/pay", async (req, res) => {
  const { id } = req.params;
  try {
    const { rows, rowCount } = await pool.query(
      `
        UPDATE payables
        SET status = 'paid', paid_at = NOW(), updated_at = NOW()
        WHERE id = $1
        RETURNING id, title, amount, due_date, status, notes, paid_at, created_at, updated_at
      `,
      [id]
    );
    if (!rowCount) return res.status(404).json({ error: "Conta não encontrada" });
    res.json(rows[0]);
  } catch (err) {
    console.error("Erro ao registrar pagamento", err);
    res.status(500).json({ error: "Erro ao registrar pagamento" });
  }
});

export default router;
