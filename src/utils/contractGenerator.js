// src/utils/contractGenerator.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import tmp from "tmp";
import { execFile } from "child_process";

// gambiarra padrão para __dirname em ESModules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEMPLATE_PATH = path.join(__dirname, "..", "templates", "contrato.docx");

const PLACEHOLDERS = [
  "comprador",
  "comprador_cpf",
  "comprador_endereco",
  "comprador_telefone",
  "tipo_pagamento",
  "condicoes_pagamento",
  "veiculo_modelo",
  "veiculo_ano",
  "veiculo_cor",
  "veiculo_placa",
  "valor_venda",
  "valor_sinal",
  "qtd_parcelas",
  "valor_parcelas",
  "data_pagamento_parcela",
  "data_pagamento_primeira_parcela",
  "data_pagamento_ultima_parcela",
  "dia_venda",
  "mes_venda",
  "ano_venda",
];

function escapeXml(str = "") {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Preenche o template contrato.docx com os dados informados
 * e grava um arquivo DOCX temporário. Retorna o objeto tmpFile.
 */
export function generateFilledDocx(contractData) {
  const content = fs.readFileSync(TEMPLATE_PATH);

  // Em vez de usar o Docxtemplater (que acusa template quebrado),
  // fazemos substituição direta no XML do documento.
  const zip = new PizZip(content);
  let xml = zip.file("word/document.xml").asText();

  // Normaliza placeholders que podem ter sido quebrados em múltiplos <w:t>
  PLACEHOLDERS.forEach((key) => {
    const splitRegex = new RegExp(`{{[\\s\\S]*?${key}[\\s\\S]*?}}`, "g");
    xml = xml.replace(splitRegex, `{{${key}}}`);
  });

  PLACEHOLDERS.forEach((key) => {
    const value = escapeXml(contractData[key] || "");
    const re = new RegExp(`{{\\s*${key}\\s*}}`, "g");
    xml = xml.replace(re, value);
  });

  zip.file("word/document.xml", xml);

  const buf = zip.generate({ type: "nodebuffer" });

  // cria arquivo temporário .docx
  const tmpFile = tmp.fileSync({ postfix: ".docx" });
  fs.writeFileSync(tmpFile.name, buf);

  return tmpFile;
}

/**
 * Converte um DOCX em PDF usando LibreOffice (soffice --headless) instalado no host.
 * Recebe o objeto tmpFile retornado por generateFilledDocx.
 * Retorna o caminho do PDF gerado.
 */
export function convertDocxToPdf(docxTmpFile) {
  return new Promise((resolve, reject) => {
    const inputPath = docxTmpFile.name;
    const outputDir = path.dirname(inputPath);
    const fileName = path.basename(inputPath);

    // Primeiro tenta usar soffice local
    const localArgs = [
      "--headless",
      "--convert-to",
      "pdf",
      fileName,
      "--outdir",
      outputDir,
    ];

    execFile("soffice", localArgs, { cwd: outputDir }, (localErr, localStdout, localStderr) => {
      if (!localErr) {
        const pdfPath = inputPath.replace(/\.docx?$/i, ".pdf");
        if (!fs.existsSync(pdfPath)) {
          console.error("STDOUT:", localStdout);
          return reject(new Error("PDF não foi gerado."));
        }
        return resolve(pdfPath);
      }

      // Fallback: docker com sudo (libreoffice container)
      console.warn("soffice não disponível, tentando via docker (sudo) com entrypoint libreoffice...");
      const dockerArgs = [
        "docker",
        "run",
        "--rm",
        "-v",
        `${outputDir}:/workspace`,
        "-w",
        "/workspace",
        "--entrypoint",
        "libreoffice",
        "ghcr.io/linuxserver/libreoffice:latest",
        "--headless",
        "--convert-to",
        "pdf",
        "--outdir",
        "/workspace",
        fileName,
      ];

      execFile("sudo", dockerArgs, { cwd: outputDir }, (error, stdout, stderr) => {
        if (error) {
          console.error("Erro na conversão LibreOffice via Docker (sudo):", error);
          console.error("STDERR:", stderr);
          return reject(
            new Error(
              "Falha ao converter para PDF via Docker. Verifique permissões do Docker ou instalação do LibreOffice."
            )
          );
        }

        const pdfPath = inputPath.replace(/\.docx?$/i, ".pdf");

        if (!fs.existsSync(pdfPath)) {
          console.error("STDOUT:", stdout);
          return reject(new Error("PDF não foi gerado."));
        }

        resolve(pdfPath);
      });
    });
  });
}
