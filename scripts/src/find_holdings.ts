import { db, pool, portfoliosTable, portfolioHoldingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

async function main() {
  const portfolios = await db.select().from(portfoliosTable);
  console.log(`=== Portfolios (${portfolios.length}) ===`);
  for (const p of portfolios) {
    console.log(`Portfolio ID: ${p.id}, Name: ${p.name}, Owner: ${p.ownerKey}, Default: ${p.isDefault}`);
    const holdings = await db
      .select()
      .from(portfolioHoldingsTable)
      .where(eq(portfolioHoldingsTable.portfolioId, p.id));
    console.log(`  Holdings (${holdings.length}):`);
    for (const h of holdings) {
      console.log(`    Symbol: ${h.symbol}, Exchange: ${h.exchange}, Qty: ${h.qty}, Rate: ${h.rate}, ISIN: ${h.isin}, ManualCMP: ${h.manualCmp}`);
    }
  }
}

main()
  .then(async () => {
    await pool.end();
  })
  .catch(async (e) => {
    console.error(e);
    await pool.end().catch(() => {});
  });
