import { retentionSettings } from "../common/database";
import { HttpError } from "../common/http-error";
import { withArtifactAccess } from "../common/artifact-access";

export async function getRetentionSettings() {
  const record = await retentionSettings.findOne({ _id: "retention" });
  const value = record || {
    enabled: false,
    retentionDays: 30,
    intervalHours: 24,
  };
  const base =
    record?.lastRunAt && record.lastRunAt > record.updatedAt
      ? record.lastRunAt
      : record?.updatedAt;
  return {
    ...value,
    nextRunAt:
      value.enabled && base
        ? new Date(base.getTime() + value.intervalHours * 3600000)
        : null,
  };
}

export async function saveRetentionSettings(
  body: Record<string, unknown> | undefined,
  username: string,
) {
  if (
    typeof body?.enabled !== "boolean" ||
    !Number.isInteger(body.retentionDays) ||
    Number(body.retentionDays) < 1 ||
    Number(body.retentionDays) > 3650 ||
    !Number.isInteger(body.intervalHours) ||
    Number(body.intervalHours) < 1 ||
    Number(body.intervalHours) > 8760
  ) {
    throw new HttpError(
      400,
      "Informe a limpeza habilitada ou desabilitada, retenção de 1 a 3650 dias e intervalo de 1 a 8760 horas.",
    );
  }
  return withArtifactAccess(async () => {
    await retentionSettings.updateOne(
      { _id: "retention" },
      {
        $set: {
          enabled: body.enabled as boolean,
          retentionDays: Number(body.retentionDays),
          intervalHours: Number(body.intervalHours),
          updatedAt: new Date(),
          updatedBy: username,
        },
      },
      { upsert: true },
    );
    return getRetentionSettings();
  });
}
