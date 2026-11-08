/** Creates the Pro/Business monthly products in AbacatePay and prints their ids for .env. */
import "dotenv/config";
import { ensureProducts } from "@/infrastructure/payments/abacatepay";

const apiKey = process.env.ABACATEPAY_API_KEY;
if (!apiKey) {
  console.error("Set ABACATEPAY_API_KEY first.");
  process.exit(1);
}
const ids = await ensureProducts({ apiKey });
console.log(`ABACATEPAY_PRODUCT_PRO=${ids.pro}\nABACATEPAY_PRODUCT_BUSINESS=${ids.business}`);
