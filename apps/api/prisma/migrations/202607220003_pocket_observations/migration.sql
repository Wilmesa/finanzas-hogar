-- La finalidad visible del bolsillo la define libremente el usuario.
-- El enum purpose se conserva como detalle técnico para compatibilidad histórica.
ALTER TABLE "Pocket" ADD COLUMN "notes" TEXT;
