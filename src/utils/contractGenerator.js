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

/**
 * Preenche o template contrato.docx com os dados informados
 * e grava um arquivo DOCX temporário. Retorna o objeto tmpFile.
 */
export function generateFilledDocx(contractData) {
  const content = fs.readFileSync(TEMPLATE_PATH);

  const zip = new PizZip(content);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
  });

  doc.setData(contractData);

  try {
    doc.render();
  } catch (error) {
    if (error?.properties?.errors?.length) {
      console.error("Erro ao renderizar DOCX (detalhes):");
      error.properties.errors.forEach((e, idx) => {
        console.error(`#${idx + 1}: ${e.properties?.explanation || e.message || e}`);
      });
    } else {
      console.error("Erro ao renderizar DOCX:", error);
    }
    throw error;
  }

  const buf = doc.getZip().generate({ type: "nodebuffer" });

  // cria arquivo temporário .docx
  const tmpFile = tmp.fileSync({ postfix: ".docx" });
  fs.writeFileSync(tmpFile.name, buf);

  return tmpFile;
}

/**
 * Converte um DOCX em PDF usando LibreOffice dentro de um container Docker.
 * Recebe o objeto tmpFile retornado por generateFilledDocx.
 * Retorna o caminho do PDF gerado.
 */
export function convertDocxToPdf(docxTmpFile) {
  return new Promise((resolve, reject) => {
    const inputPath = docxTmpFile.name;
    const outputDir = path.dirname(inputPath);
    const fileName = path.basename(inputPath);

    // docker precisa enxergar o arquivo dentro de /workspace
    // mapeamos outputDir -> /workspace e rodamos o LibreOffice lá dentro
    const args = [
      "run",
      "--rm",
      "-v",
      `${outputDir}:/workspace`,
      "ghcr.io/linuxserver/libreoffice:latest",
      "--headless",
      "--convert-to",
      "pdf",
      fileName,
    ];

    execFile("docker", args, { cwd: outputDir }, (error, stdout, stderr) => {
      if (error) {
        console.error("Erro na conversão LibreOffice via Docker:", error);
        console.error("STDERR:", stderr);
        return reject(error);
      }

      const pdfPath = inputPath.replace(/\.docx?$/i, ".pdf");

      if (!fs.existsSync(pdfPath)) {
        console.error("STDOUT:", stdout);
        return reject(new Error("PDF não foi gerado."));
      }

      resolve(pdfPath);
    });
  });
}
