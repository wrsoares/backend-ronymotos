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
    const lastInstallment = installments[installments.length - 1];
    const isInstallment = installments.length > 0;
    const formatDate = (d) =>
      d ? new Date(d).toLocaleDateString("pt-BR") : "";
    const formatCurrency = (value) => {
      const n = Number(value) || 0;
      return n.toFixed(2).replace(".", ",");
    };
    const valorVendaStr = formatCurrency(sale.total_price);
    const valorSinalStr = Number(sale.entry_amount)
      ? `R$ ${formatCurrency(sale.entry_amount)} de entrada`
      : "Sem entrada";
    const tipoPagamentoStr = isInstallment
      ? "Parcelado com entrada"
      : "À vista";
    const dataPrimeiraParcela = isInstallment
      ? formatDate(firstInstallment?.due_date)
      : "";
    const dataUltimaParcela = isInstallment
      ? formatDate(lastInstallment?.due_date)
      : "";
    const paragrafoBase = `O valor da presente negociação, ajustado livremente entre as partes, é de R$ ${valorVendaStr}, que será pago nas seguintes condições: ${tipoPagamentoStr}.`;
    const paragrafoParcelado = isInstallment
      ? `Com valor de entrada ${valorSinalStr} e o valor restante dividido em ${installments.length} parcelas com valor de R$ ${formatCurrency(firstInstallment?.amount_due || 0)}. Com as parcelas iniciando em ${dataPrimeiraParcela} e finalizando em ${dataUltimaParcela}.`
      : "";
    const condicoesPagamento = paragrafoParcelado
      ? `${paragrafoBase}\n\n${paragrafoParcelado}`
      : paragrafoBase;

    // 2. Monta o objeto de dados para o template DOCX (as chaves {{...}})
    const contractData = {
      comprador: sale.buyer_name,
      comprador_cpf: sale.buyer_cpf_last4 ? `***.***.***-${sale.buyer_cpf_last4}` : "",
      comprador_endereco: sale.buyer_address || "",
      comprador_telefone: sale.buyer_phone || "",

      tipo_pagamento: tipoPagamentoStr,
      condicoes_pagamento: condicoesPagamento,

      veiculo_modelo: sale.model,
      veiculo_ano: sale.year?.toString() || "",
      veiculo_cor: sale.color || "",
      veiculo_placa: sale.plate || "",
      veiculo_chassi: sale.chassis || "",

      valor_venda: valorVendaStr,
      valor_sinal: isInstallment ? valorSinalStr : "",
      qtd_parcelas: isInstallment ? `${installments.length} parcelas` : "",
      valor_parcelas: isInstallment
        ? `R$ ${formatCurrency(firstInstallment?.amount_due)}`
        : "",
      data_pagamento_parcela: isInstallment ? dataPrimeiraParcela : "",
      data_pagamento_primeira_parcela: dataPrimeiraParcela,
      data_pagamento_ultima_parcela: dataUltimaParcela,

      dia_venda: sale.sale_date
        ? new Date(sale.sale_date).getDate().toString().padStart(2, "0")
        : "",
      mes_venda: sale.sale_date
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
        if (fs.existsSync(pdfPath)) {
          const stat = fs.statSync(pdfPath);
          if (stat.isFile()) {
            fs.unlinkSync(pdfPath);
          }
        }
      } catch (e) {
        if (!["ENOENT", "ENOTDIR", "EPERM", "EACCES"].includes(e?.code)) {
          console.error("Erro ao apagar temporários:", e?.message || e);
        }
      }
    });
  } catch (err) {
    if (err?.properties?.errors?.length) {
      console.error("Erro ao gerar contrato PDF (detalhes):");
      err.properties.errors.forEach((e, idx) => {
        console.error(`#${idx + 1}: ${e.properties?.explanation || e.message || e}`);
      });
    }
    console.error("Erro ao gerar contrato PDF:", err);
    return res.status(500).json({ error: "Erro ao gerar contrato." });
  } finally {
    client.release();
  }
});

export default router;
