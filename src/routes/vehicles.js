// src/routes/vehicles.js
import express from "express";
import { pool } from "../config/db.js";
import { encryptCPF, decryptCPF, extractLast4 } from "../utils/cpfCrypto.js";

const router = express.Router();

// Normaliza arrays opcionais
function normalizeBody(req, res, next) {
  req.body.owners = Array.isArray(req.body.owners) ? req.body.owners : [];
  req.body.images = Array.isArray(req.body.images) ? req.body.images : [];
  req.body.documents = Array.isArray(req.body.documents) ? req.body.documents : [];
  next();
}

/* ========= CREATE ========= */
router.post("/", normalizeBody, async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      brand,
      model,
      year,
      color,
      price,
      mileage_km,
      fuel,
      renavam,
      chassis,
      plate,
      status = "disponivel",
      owners,
      images,
      documents
    } = req.body;

    if (
      !brand || !model || !year || !color ||
      price == null || mileage_km == null ||
      !fuel || !renavam || !chassis || !plate
    ) {
      return res.status(400).json({ ok: false, error: "Campos obrigatórios não preenchidos." });
    }

    if (images.length > 3) {
      return res.status(400).json({ ok: false, error: "Máximo de 3 imagens por veículo." });
    }

    await client.query("BEGIN");

    const insertVehicle = `
      INSERT INTO vehicles
        (brand, model, year, color, price, mileage_km, fuel, renavam, chassis, plate, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *;
    `;
    const { rows: [vehicle] } = await client.query(insertVehicle, [
      brand, model, year, color, price, mileage_km, fuel, renavam, chassis, plate, status
    ]);

    const vehicleId = vehicle.id;

    // Donos anteriores
    for (let i = 0; i < owners.length; i++) {
      const o = owners[i];
      if (!o.full_name || !o.full_address || !o.cpf || !o.phone) continue;

      const cpfEncrypted = encryptCPF(o.cpf);
      const cpfLast4 = extractLast4(o.cpf);

      await client.query(
        `
        INSERT INTO vehicle_previous_owners
          (vehicle_id, owner_index, full_name, full_address, cpf_encrypted, cpf_last4, phone)
        VALUES ($1,$2,$3,$4,$5,$6,$7);
        `,
        [vehicleId, i + 1, o.full_name, o.full_address, cpfEncrypted, cpfLast4, o.phone]
      );
    }

    // Imagens
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      if (!img.url) continue;

      await client.query(
        `
        INSERT INTO vehicle_images (vehicle_id, url, position, is_cover)
        VALUES ($1,$2,$3,$4);
        `,
        [vehicleId, img.url, i + 1, !!img.is_cover]
      );
    }

    // Documentos
    for (const doc of documents) {
      if (!doc.url) continue;
      await client.query(
        `
        INSERT INTO vehicle_documents (vehicle_id, url, document_type)
        VALUES ($1,$2,$3);
        `,
        [vehicleId, doc.url, doc.document_type || null]
      );
    }

    await client.query("COMMIT");

    res.status(201).json({ ok: true, vehicleId });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    client.release();
  }
});

/* ========= LIST (sem detalhes) ========= */
router.get("/", async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 20;
    const offset = Number(req.query.offset) || 0;

    const { rows } = await pool.query(
      `
      SELECT
        v.*,
        COALESCE(
          (SELECT url FROM vehicle_images vi
             WHERE vi.vehicle_id = v.id
             ORDER BY is_cover DESC, position ASC
             LIMIT 1),
          NULL
        ) AS cover_image
      FROM vehicles v
      WHERE v.deleted_at IS NULL
      ORDER BY v.created_at DESC
      LIMIT $1 OFFSET $2;
      `,
      [limit, offset]
    );

    res.json({ ok: true, vehicles: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ========= GET BY ID (com detalhes) ========= */
router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ ok: false, error: "ID inválido." });

  const client = await pool.connect();
  try {
    const { rows: vRows } = await client.query(
      "SELECT * FROM vehicles WHERE id = $1 AND deleted_at IS NULL;",
      [id]
    );
    if (!vRows.length) {
      return res.status(404).json({ ok: false, error: "Veículo não encontrado." });
    }

    const vehicle = vRows[0];

    const { rows: ownersRows } = await client.query(
      `
      SELECT id, owner_index, full_name, full_address, cpf_encrypted, cpf_last4, phone, created_at
      FROM vehicle_previous_owners
      WHERE vehicle_id = $1
      ORDER BY owner_index ASC;
      `,
      [id]
    );

    const owners = ownersRows.map(o => ({
      id: o.id,
      owner_index: o.owner_index,
      full_name: o.full_name,
      full_address: o.full_address,
      cpf: decryptCPF(o.cpf_encrypted), // aqui devolvemos o CPF em texto
      cpf_last4: o.cpf_last4,
      phone: o.phone,
      created_at: o.created_at
    }));

    const { rows: images } = await client.query(
      `
      SELECT id, url, position, is_cover, created_at
      FROM vehicle_images
      WHERE vehicle_id = $1
      ORDER BY position ASC;
      `,
      [id]
    );

    const { rows: documents } = await client.query(
      `
      SELECT id, url, document_type, created_at
      FROM vehicle_documents
      WHERE vehicle_id = $1
      ORDER BY created_at ASC;
      `,
      [id]
    );

    res.json({
      ok: true,
      vehicle,
      owners,
      images,
      documents
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    client.release();
  }
});

/* ========= UPDATE ========= */
router.put("/:id", normalizeBody, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ ok: false, error: "ID inválido." });

  const client = await pool.connect();
  try {
    const {
      brand,
      model,
      year,
      color,
      price,
      mileage_km,
      fuel,
      renavam,
      chassis,
      plate,
      status = "disponivel",
      owners,
      images,
      documents
    } = req.body;

    await client.query("BEGIN");

    const updateVehicle = `
      UPDATE vehicles
      SET brand = $1,
          model = $2,
          year = $3,
          color = $4,
          price = $5,
          mileage_km = $6,
          fuel = $7,
          renavam = $8,
          chassis = $9,
          plate = $10,
          status = $11,
          updated_at = NOW()
      WHERE id = $12 AND deleted_at IS NULL
      RETURNING *;
    `;

    const { rows: [updated] } = await client.query(updateVehicle, [
      brand, model, year, color, price, mileage_km, fuel,
      renavam, chassis, plate, status, id
    ]);

    if (!updated) {
      await client.query("ROLLBACK");
      return res.status(404).json({ ok: false, error: "Veículo não encontrado." });
    }

    // Remove relacionamentos antigos e recria (mais simples para o início)
    await client.query("DELETE FROM vehicle_previous_owners WHERE vehicle_id = $1;", [id]);
    await client.query("DELETE FROM vehicle_images WHERE vehicle_id = $1;", [id]);
    await client.query("DELETE FROM vehicle_documents WHERE vehicle_id = $1;", [id]);

    // Reinsere donos
    for (let i = 0; i < owners.length; i++) {
      const o = owners[i];
      if (!o.full_name || !o.full_address || !o.cpf || !o.phone) continue;

      const cpfEncrypted = encryptCPF(o.cpf);
      const cpfLast4 = extractLast4(o.cpf);

      await client.query(
        `
        INSERT INTO vehicle_previous_owners
          (vehicle_id, owner_index, full_name, full_address, cpf_encrypted, cpf_last4, phone)
        VALUES ($1,$2,$3,$4,$5,$6,$7);
        `,
        [id, i + 1, o.full_name, o.full_address, cpfEncrypted, cpfLast4, o.phone]
      );
    }

    // Reinsere imagens
    if (images.length > 3) {
      throw new Error("Máximo de 3 imagens por veículo.");
    }

    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      if (!img.url) continue;

      await client.query(
        `
        INSERT INTO vehicle_images (vehicle_id, url, position, is_cover)
        VALUES ($1,$2,$3,$4);
        `,
        [id, img.url, i + 1, !!img.is_cover]
      );
    }

    // Reinsere documentos
    for (const doc of documents) {
      if (!doc.url) continue;

      await client.query(
        `
        INSERT INTO vehicle_documents (vehicle_id, url, document_type)
        VALUES ($1,$2,$3);
        `,
        [id, doc.url, doc.document_type || null]
      );
    }

    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    client.release();
  }
});

/* ========= DELETE (soft delete) ========= */
router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ ok: false, error: "ID inválido." });

  try {
    const { rowCount } = await pool.query(
      `
      UPDATE vehicles
      SET deleted_at = NOW()
      WHERE id = $1 AND deleted_at IS NULL;
      `,
      [id]
    );

    if (!rowCount) {
      return res.status(404).json({ ok: false, error: "Veículo não encontrado." });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
