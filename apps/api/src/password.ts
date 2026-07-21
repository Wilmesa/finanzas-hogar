import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
const KEY_LENGTH = 64;
const COST = 65_536;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const MAX_MEMORY = 96 * 1024 * 1024;

function derive(password: string, salt: Buffer, length: number) {
  return new Promise<Buffer>((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      length,
      {
        N: COST,
        r: BLOCK_SIZE,
        p: PARALLELIZATION,
        maxmem: MAX_MEMORY,
      },
      (error, derivedKey) =>
        error ? reject(error) : resolve(derivedKey as Buffer),
    );
  });
}

export function validatePassword(password: string) {
  if (password.length < 12 || password.length > 128) {
    throw new Error("La contraseña debe tener entre 12 y 128 caracteres");
  }
}

export async function hashPassword(password: string): Promise<string> {
  validatePassword(password);
  const salt = randomBytes(32);
  const derived = await derive(password, salt, KEY_LENGTH);
  return [
    "scrypt",
    "v=1",
    `N=${COST},r=${BLOCK_SIZE},p=${PARALLELIZATION}`,
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(
  password: string,
  encoded: string,
): Promise<boolean> {
  const [algorithm, version, parameters, saltValue, hashValue] =
    encoded.split("$");
  if (
    algorithm !== "scrypt" ||
    version !== "v=1" ||
    !parameters ||
    !saltValue ||
    !hashValue
  ) {
    return false;
  }
  const values = Object.fromEntries(
    parameters.split(",").map((entry) => entry.split("=")),
  );
  const N = Number(values.N);
  const r = Number(values.r);
  const p = Number(values.p);
  if (N !== COST || r !== BLOCK_SIZE || p !== PARALLELIZATION) return false;
  try {
    const expected = Buffer.from(hashValue, "base64url");
    const actual = await derive(
      password,
      Buffer.from(saltValue, "base64url"),
      expected.length,
    );
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  } catch {
    return false;
  }
}
