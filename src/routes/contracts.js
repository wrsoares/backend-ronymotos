// src/routes/contracts.js
import express from "express";
import { pool } from "../config/db.js";
import { requireAuth } from "../middlewares/requireAuth.js";
import { generateFilledDocx, convertDocxToPdf } from "../utils/contractGenerator.js";
import fs from "fs";

const router = express.Router();

// protege tudo
router.use(requireAuth);

/**
 * GET /contracts/:saleId/pdf
 * Gera o contrato (DOCX) para a venda e converte para PDF em tempo real.
 */
router.get("/:saleId/pdf", async (req, res) => {
  const client = await pool.connect();

  try {
    const { saleId } = req.params;

    // 1. Busca dados da venda + veículo
    const { rows } = await client.query(
      `
      SELECT
        s.*,
        v.brand,
        v.model,
        v.year,
        v.color,
        v.plate,
        v.chassis
      FROM sales s
      JOIN vehicles v ON v.id = s.vehicle_id
      WHERE s.id = $1
      `,
      [saleId]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Venda não encontrada." });
    }

    const sale = rows[0];

    // Busca parcelas (se existirem) para preencher campos de parcela
    const installmentsResult = await client.query(
      `
        SELECT number, due_date, amount_due
        FROM sales_installments
        WHERE sale_id = $1
        ORDER BY number ASC
      `,
      [saleId]
    );

    const installments = installmentsResult.rows || [];
    const firstInstallment = installments[0];
    const formatCurrency = (value) => {
      const n = Number(value) || 0;
      return n.toFixed(2).replace(".", ",");
    };

    // 2. Monta o objeto de dados para o template DOCX (as chaves {{...}})
    const contractData = {
      comprador: sale.buyer_name,
      comprador_cpf: sale.buyer_cpf_last4 ? `***.***.***-${sale.buyer_cpf_last4}` : "",
      comprador_endereco: sale.buyer_address || "",
      comprador_telefone: sale.buyer_phone || "",

      veiculo_modelo: sale.model,
      veiculo_ano: sale.year?.toString() || "",
      veiculo_cor: sale.color || "",
      veiculo_placa: sale.plate || "",
      veiculo_chassi: sale.chassis || "",

      valor_venda: formatCurrency(sale.total_price),
      valor_sinal: Number(sale.entry_amount)
        ? `R$ ${formatCurrency(sale.entry_amount)} de entrada`
        : "Sem entrada",
      qtd_parcelas: installments.length
        ? `${installments.length} parcelas`
        : "Pagamento à vista",
      valor_parcelas: installments.length
        ? `R$ ${formatCurrency(firstInstallment.amount_due)}`
        : "",
      data_pagamento_parcela: installments.length
        ? new Date(firstInstallment.due_date).toLocaleDateString("pt-BR")
        : "",

      dia_venda: sale.sale_date
        ? new Date(sale.sale_date).getDate().toString().padStart(2, "0")
        : "",
      mês_venda: sale.sale_date
        ? new Intl.DateTimeFormat("pt-BR", { month: "long" }).format(
            new Date(sale.sale_date)
          )
        : "",
      ano_venda: sale.sale_date
        ? new Date(sale.sale_date).getFullYear().toString()
        : ""
    };

    // 3. Gera DOCX preenchido em arquivo temporário
    const docxTmpFile = generateFilledDocx(contractData);

    // 4. Converte para PDF
    const pdfPath = await convertDocxToPdf(docxTmpFile);

    // 5. Envia o PDF
    const stream = fs.createReadStream(pdfPath);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="contrato-${saleId}.pdf"`
    );

    stream.pipe(res);

    stream.on("close", () => {
      // limpa arquivos temporários
      try {
        docxTmpFile.removeCallback(); // remove o .docx
        fs.unlinkSync(pdfPath);       // remove o .pdf
      } catch (e) {
        console.error("Erro ao apagar temporários:", e);
      }
    });
  } catch (err) {
    console.error("Erro ao gerar contrato PDF:", err);
    return res.status(500).json({ error: "Erro ao gerar contrato." });
  } finally {
    client.release();
  }
});

export default router;
