export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getDb } = await import("@/lib/db");
    const { seedAndDetect } = await import("@/lib/seed");
    const db = getDb();
    const count = (db.prepare(`SELECT COUNT(*) as c FROM customers`).get() as { c: number }).c;
    if (count === 0) {
      console.log("[ReconcileX] No data found — seeding demo scenario...");
      seedAndDetect();
      console.log("[ReconcileX] Seed complete.");
    }
  }
}
