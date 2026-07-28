import { authMode, getCsrfToken } from "./auth";

const DATABASE = "okle-offline";
const STORE = "mutation-queue";
const SYNC_TAG = "okle-financial-mutations";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function queueOfflineTransaction(
  body: Record<string, unknown>,
  idempotencyKey: string,
) {
  if (authMode() !== "local") {
    throw new Error(
      "La captura offline requiere autenticación local. Con OIDC conserva el borrador y envíalo al recuperar conexión.",
    );
  }
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put({
      id: idempotencyKey,
      path: "/api/v1/transactions",
      body,
      csrfToken: getCsrfToken(),
      createdAt: new Date().toISOString(),
      status: "queued",
    });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  const registration = await navigator.serviceWorker.ready;
  const syncRegistration = registration as ServiceWorkerRegistration & {
    sync?: { register(tag: string): Promise<void> };
  };
  await syncRegistration.sync?.register(SYNC_TAG);
  return { idempotencyKey, status: "queued" as const };
}
