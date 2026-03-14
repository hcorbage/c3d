import app from "./app.js";
import { seedAdminUser } from "./lib/seed-admin.js";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Seed admin user on startup
seedAdminUser().catch(console.error);

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
