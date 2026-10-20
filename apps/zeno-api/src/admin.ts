import { z } from "zod";
import { bootstrapAdmin, issueInvite, issuePasswordReset } from "./auth";
import { openDatabase } from "./database";
import { dirname, join } from "node:path";
import { setOperatorFeature } from "./operator";

const [command, ...args] = process.argv.slice(2);
if (command === "features") {
  const [action, key, value] = args;
  if (action !== "set" || !key || !value || args.length !== 3) throw new Error("Usage: admin features set FEATURE true|false");
  const databasePath = z.string().min(1).parse(process.env.ZENO_DATABASE_PATH);
  console.log(JSON.stringify(setOperatorFeature(process.env.ZENO_OPERATOR_PROFILE ?? join(dirname(databasePath), "operator-profile.json"), key, value)));
} else {
const fields = new Map<string, string>();
for (let index = 0; index < args.length; index += 2) {
  const key = args[index]; const value = args[index + 1];
  if (!key?.startsWith("--") || !value || fields.has(key)) throw new Error("Usage: admin bootstrap|invite|reset --email EMAIL [--name NAME] [--admin ADMIN_EMAIL]");
  fields.set(key, value);
}
if (!["bootstrap", "invite", "reset"].includes(command ?? "")) throw new Error("Expected bootstrap, invite, or reset");
const path = z.string().min(1).parse(process.env.ZENO_DATABASE_PATH); const database = openDatabase(path);
try {
  const email = z.email().parse(fields.get("--email"));
  if (command === "invite" || command === "reset") {
    const adminEmail = z.email().parse(fields.get("--admin"));
    const row = z.object({ id: z.string() }).parse(database.sqlite.query("SELECT id FROM user WHERE email=? AND role='admin' AND disabled=0").get(adminEmail.toLowerCase()));
    const invite = command === "invite" ? issueInvite(database, row.id, email) : issuePasswordReset(database, row.id, email);
    const origin = z.url().parse(process.env.ZENO_PUBLIC_ORIGIN);
    // One-time operator output. Do not save it into source/evidence or public logs.
    console.log(JSON.stringify({ email: invite.email, expiresAt: invite.expiresAt, url: `${new URL(origin).origin}/app/${command === "invite" ? "invite" : "reset"}?token=${encodeURIComponent(invite.token)}` }));
  } else {
    // Passwords are read from private stdin, never command-line args or logs.
    const password = (await Bun.stdin.text()).replace(/\r?\n$/, "");
    console.log(JSON.stringify({ userId: await bootstrapAdmin(database, { email, name: fields.get("--name") ?? "管理员", password }) }));
  }
} finally { database.close(); }
}
