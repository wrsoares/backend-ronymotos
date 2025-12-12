// src/routes/sales.js
import express from "express";
import { pool } from "../config/db.js";
import { requireAuth } from "../middlewares/requireAuth.js";
import { encryptCPF, extractLast4 } from "../utils/cpfCrypto.js";

const router = express.Router();

// helper para recalcular status da venda (open / settled)
async function recalcSaleStatus(client, saleId) {
  const { rows } = await client.query(
    `
      SELECT
        s.total_price,
        COALESCE(SUM(p.amount_paid), 0) AS total_paid
      FROM sales s
      LEFT JOIN payments p ON p.sale_id = s.id
      WHERE s.id = $1
      GROUP BY s.total_price
    `,
    [saleId]
  );

  if (!rows.length) return;

  const { total_price, total_paid } = rows[0];
  const isSettled = Number(total_paid) >= Number(total_price);

  await client.query(
    `UPDATE sales SET status = $1 WHERE id = $2`,
    [isSettled ? "settled" : "open", saleId]
  );
}

/**
 * POST /sales
 * Cria venda + parcelas + pagamento de entrada (se houver) + marca veículo como vendido
 *
 * Body esperado:
 * {
 *   vehicle_id: number,
 *   buyer_name: string,
 *   buyer_cpf?: string,
 *   buyer_phone?: string,
 *   buyer_address?: string,
 *   list_price?: number,
 *   total_price: number,
 *   entry_amount?: number,
 *   sale_date?: string (YYYY-MM-DD),
 *   notes?: string,
 *   installments: [{ number, due_date, amount_due }],
 *   entry_method?: "cash" | "pix" | ...
 * }
 */
router.post("/", requireAuth, async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      vehicle_id,
      buyer_name,
      buyer_cpf,
      buyer_phone,
      buyer_address,
      list_price,
      total_price,
      entry_amount = 0,
      sale_date,
      notes,
      installments = [],
      entry_method = "cash"
    } = req.body;

    if (!vehicle_id || !buyer_name || !total_price) {
      return res
        .status(400)
        .json({ error: "vehicle_id, buyer_name e total_price são obrigatórios." });
    }

    await client.query("BEGIN");

    // CPF criptografado + últimos 4 dígitos
    const cpfEncryptedStr = buyer_cpf ? encryptCPF(buyer_cpf) : null;
    const cpfEncryptedBuf = cpfEncryptedStr
      ? Buffer.from(cpfEncryptedStr, "utf8")
      : null;
    const cpfLast4 = buyer_cpf ? extractLast4(buyer_cpf) : null;

    // 1. Criar venda
    const saleResult = await client.query(
      `
        INSERT INTO sales (
          vehicle_id,
          buyer_name,
          buyer_cpf_encrypted,
          buyer_cpf_last4,
          buyer_phone,
          buyer_address,
          list_price,
          total_price,
          entry_amount,
          sale_date,
          notes
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,
          COALESCE($10, CURRENT_DATE),
          $11
        )
        RETURNING *
      `,
      [
        vehicle_id,
        buyer_name,
        cpfEncryptedBuf,
        cpfLast4,
        buyer_phone,
        buyer_address,
        list_price,
        total_price,
        entry_amount,
        sale_date,
        notes
      ]
    );

    const sale = saleResult.rows[0];

    // 2. Criar parcelas
    for (const inst of installments) {
      await client.query(
        `
          INSERT INTO sales_installments (
            sale_id,
            number,
            due_date,
            amount_due
          )
          VALUES ($1,$2,$3,$4)
        `,
        [sale.id, inst.number, inst.due_date, inst.amount_due]
      );
    }

    // 3. Pagamento da entrada (se houver)
    if (Number(entry_amount) > 0) {
      await client.query(
        `
          INSERT INTO payments (
            sale_id,
            installment_id,
            amount_paid,
            method,
            is_entry,
            notes
          )
          VALUES ($1, NULL, $2, $3, true, $4)
        `,
        [sale.id, entry_amount, entry_method, "Entrada na venda"]
      );
    }

    // 4. Atualizar veículo -> sold
    await client.query(
      `
        UPDATE vehicles
        SET status = 'sold',
            sold_at = NOW()
        WHERE id = $1
      `,
      [vehicle_id]
    );

    // 5. Recalcular status da venda (caso entrada já quite algo)
    await recalcSaleStatus(client, sale.id);

    await client.query("COMMIT");

    return res.status(201).json({ sale });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Erro ao criar venda:", err);
    return res.status(500).json({ error: "Erro ao criar venda." });
  } finally {
    client.release();
  }
});

/**
 * GET /sales
 * Lista vendas com alguns dados do veículo
 */
router.get("/", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `
        SELECT
          s.*,
          v.brand,
          v.model,
          v.year,
          v.plate
        FROM sales s
        LEFT JOIN vehicles v ON v.id = s.vehicle_id
        ORDER BY s.created_at DESC
      `
    );

    // opcional: mascara cpf
    const mapped = rows.map((row) => ({
      ...row,
      masked_cpf: row.buyer_cpf_last4
        ? `***.***.***-${row.buyer_cpf_last4}`
        : null
    }));

    return res.json(mapped);
  } catch (err) {
    console.error("Erro ao listar vendas:", err);
    return res.status(500).json({ error: "Erro ao listar vendas." });
  }
});

/**
 * GET /sales/:id
 * Retorna venda + parcelas + pagamentos
 */
router.get("/:id", requireAuth, async (req, res) => {
  const { id } = req.params;

  try {
    const saleResult = await pool.query(
      `SELECT * FROM sales WHERE id = $1`,
      [id]
    );

    if (!saleResult.rows.length) {
      return res.status(404).json({ error: "Venda não encontrada." });
    }

    const sale = saleResult.rows[0];

    const installmentsResult = await pool.query(
      `
        SELECT *
        FROM sales_installments
        WHERE sale_id = $1
        ORDER BY number ASC
      `,
      [id]
    );

    const paymentsResult = await pool.query(
      `
        SELECT *
        FROM payments
        WHERE sale_id = $1
        ORDER BY paid_at ASC
      `,
      [id]
    );

    return res.json({
      sale: {
        ...sale,
        masked_cpf: sale.buyer_cpf_last4
          ? `***.***.***-${sale.buyer_cpf_last4}`
          : null
        // se um dia quiser devolver o CPF real para perfil admin:
        // real_cpf: decryptCPF(sale.buyer_cpf_encrypted)
      },
      installments: installmentsResult.rows,
      payments: paymentsResult.rows
    });
  } catch (err) {
    console.error("Erro ao buscar venda:", err);
    return res.status(500).json({ error: "Erro ao buscar venda." });
  }
});

/**
 * POST /sales/:id/payments
 * Registra pagamento (parcela ou extra) e atualiza status
 *
 * Body:
 * {
 *   installment_id?: string (uuid),
 *   amount_paid: number,
 *   method: "cash" | "pix" | ...,
 *   notes?: string
 * }
 */
router.post("/:id/payments", requireAuth, async (req, res) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;
    const { installment_id, amount_paid, method, notes } = req.body;

    if (!amount_paid || !method) {
      return res
        .status(400)
        .json({ error: "amount_paid e method são obrigatórios." });
    }

    await client.query("BEGIN");

    // 1. criar pagamento
    await client.query(
      `
        INSERT INTO payments (
          sale_id,
          installment_id,
          amount_paid,
          method,
          is_entry,
          notes
        )
        VALUES ($1,$2,$3,$4,false,$5)
      `,
      [id, installment_id || null, amount_paid, method, notes || null]
    );

    // 2. atualizar parcela (se informado installment_id)
    if (installment_id) {
      const installmentUuid = installment_id;
      const instResult = await client.query(
        `
          SELECT amount_due, paid_amount
          FROM sales_installments
          WHERE id = $1::uuid
          FOR UPDATE
        `,
        [installmentUuid]
      );

      if (instResult.rows.length) {
        const inst = instResult.rows[0];
        const newPaid = Number(inst.paid_amount) + Number(amount_paid);
        const fullyPaid = newPaid >= Number(inst.amount_due);

        await client.query(
          `
            UPDATE sales_installments
            SET paid_amount = $1,
                status = $2::installment_status,
                paid_at = CASE WHEN ($2::installment_status) = 'paid' THEN NOW() ELSE paid_at END
            WHERE id = $3::uuid
          `,
          [newPaid, fullyPaid ? 'paid' : 'partial', installmentUuid]
        );
      }
    }

    // 3. recalcular status da venda
    await recalcSaleStatus(client, id);

    await client.query("COMMIT");

    return res.json({ success: true });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Erro ao registrar pagamento:", err);
    return res.status(500).json({ error: "Erro ao registrar pagamento." });
  } finally {
    client.release();
  }
});

export default router;
