import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export async function seedAdminUser(): Promise<void> {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;

  if (!username || !password) {
    console.log("ADMIN_USERNAME or ADMIN_PASSWORD not set, skipping admin seed");
    return;
  }

  try {
    const existing = await db.select().from(usersTable).where(eq(usersTable.username, username)).limit(1);
    if (existing.length > 0) {
      // Update to ensure admin flag is set
      if (!existing[0].isAdmin) {
        await db.update(usersTable).set({ isAdmin: true }).where(eq(usersTable.username, username));
        console.log(`Admin flag set for user: ${username}`);
      } else {
        console.log(`Admin user already exists: ${username}`);
      }
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await db.insert(usersTable).values({
      username,
      passwordHash,
      credits: 999999,
      isAdmin: true,
    });
    console.log(`Admin user created: ${username}`);
  } catch (err) {
    console.error("Failed to seed admin user:", err);
  }
}
