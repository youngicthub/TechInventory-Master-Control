// Prints a fresh, correctly-shaped value for every Master API secret.
// Paste them into MasterControl/.env. Run: npm run gen:secrets
import crypto from "node:crypto";
const hex = (bytes) => crypto.randomBytes(bytes).toString("hex");
console.log(`MASTER_JWT_SECRET=${hex(32)}`);
console.log(`MASTER_ENCRYPTION_KEY=${hex(32)}`);
console.log(`MASTER_SETUP_KEY=${hex(16)}`);
