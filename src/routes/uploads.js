// src/routes/uploads.js
import express from "express";
import multer from "multer";
import crypto from "crypto";
import path from "path";
import { uploadBufferToS3 } from "../config/s3.js";
import { requireAuth } from "../middlewares/requireAuth.js";

const router = express.Router();

// Usar memória (não salvar em disco)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  },
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error("Formato de imagem não suportado."), false);
    }
    cb(null, true);
  }
});

// POST /uploads/images
router.post(
  "/images",
  requireAuth,           // só usuário logado pode enviar
  upload.single("file"), // campo 'file' no form-data
  async (req, res) => {
    try {
      if (!req.file) {
        return res
          .status(400)
          .json({ ok: false, error: "Arquivo não enviado (campo 'file')." });
      }

      const { buffer, originalname, mimetype } = req.file;

      // Gera um nome único
      const ext = path.extname(originalname) || ".jpg";
      const randomName = crypto.randomBytes(16).toString("hex");
      const key = `vehicles/${randomName}${ext}`; // pasta 'vehicles/' no bucket

      const url = await uploadBufferToS3(buffer, key, mimetype);

      return res.status(201).json({
        ok: true,
        url,
        key
      });
    } catch (err) {
      console.error("UPLOAD /uploads/images error:", err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  }
);

export default router;
