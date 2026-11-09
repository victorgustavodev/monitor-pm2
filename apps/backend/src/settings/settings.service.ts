import { retentionSettings } from "../common/database";
import { HttpError } from "../common/http-error";
import { withArtifactAccess } from "../common/artifact-access";

export async function getRetentionSettings() {
  const record = await retentionSettings.findOne({ _id: "retention" });
  return {
    enabled: record?.enabled ?? false,
    retentionDays: record?.retentionDays ?? 30,
    updatedAt: record?.updatedAt,
    updatedBy: record?.updatedBy,
    lastRunAt: record?.lastRunAt,
    lastDeleted: record?.lastDeleted,
    lastError: record?.lastError,
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
    Number(body.retentionDays) > 3650
  ) {
    throw new HttpError(
      400,
      "Informe a limpeza habilitada ou desabilitada e o prazo de 1 a 3650 dias.",
    );
  }
  return withArtifactAccess(async () => {
    await retentionSettings.updateOne(
      { _id: "retention" },
      {
        $set: {
          enabled: body.enabled as boolean,
          retentionDays: Number(body.retentionDays),
          updatedAt: new Date(),
          updatedBy: username,
        },
        $unset: { intervalHours: "" },
      },
      { upsert: true },
    );
    return getRetentionSettings();
  });
}
