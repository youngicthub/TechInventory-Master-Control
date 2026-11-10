import { Router, type IRouter } from "express";
import { z } from "zod";
import { db, platformSettingsTable } from "@masterctl/db";
import { requireAdminAuth, requirePermission } from "../middlewares/auth";
import { SETTING_DEFS, getSetting, setCached } from "../lib/settings";
import { writeMasterAuditLog } from "../lib/audit";

const router: IRouter = Router();
router.use("/settings", requireAdminAuth);

router.get("/settings", requirePermission("settings.view"), (_req, res) => {
  res.json(SETTING_DEFS.map((d) => ({ ...d, value: getSetting(d.key) })));
});

const saveSchema = z.object({ values: z.record(z.string(), z.number()), reason: z.string().trim().max(300).optional() });

router.put("/settings", requirePermission("settings.manage"), async (req, res) => {
  const parsed = saveSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Send { values: { key: number } }" });

  const changes: { def: (typeof SETTING_DEFS)[number]; from: number; to: number }[] = [];
  for (const [key, value] of Object.entries(parsed.data.values)) {
    const def = SETTING_DEFS.find((d) => d.key === key);
    if (!def) return res.status(400).json({ error: `Unknown setting "${key}"` });
    if (!Number.isInteger(value) || value < def.min || value > def.max) {
      return res.status(400).json({ error: `${def.label} must be a whole number between ${def.min} and ${def.max} ${def.unit}.` });
    }
    if (value !== getSetting(key)) changes.push({ def, from: getSetting(key), to: value });
  }
  if (changes.length === 0) return res.json({ changed: 0 });

  for (const { def, to } of changes) {
    await db
      .insert(platformSettingsTable)
      .values({ key: def.key, value: JSON.stringify(to), updatedBy: req.admin!.sub })
      .onConflictDoUpdate({ target: platformSettingsTable.key, set: { value: JSON.stringify(to), updatedBy: req.admin!.sub, updatedAt: new Date() } });
    setCached(def.key, to);
  }
  await writeMasterAuditLog({
    adminId: req.admin!.sub,
    action: "settings.update",
    description: `Changed ${changes.map((c) => `${c.def.label}: ${c.from} → ${c.to} ${c.def.unit}`).join("; ")}`,
    reason: parsed.data.reason,
  });
  res.json({ changed: changes.length });
});

export default router;
