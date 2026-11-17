export type BrandRegistryRow = Record<string, unknown>;
export type BrandAssignmentRow = Record<string, unknown>;

export type TrackedBrandConfigurationResult =
  | {
    ok: true;
    trackedRecord: BrandRegistryRow;
    fixedTrackedId: string;
    directoryById: Map<string, BrandRegistryRow>;
    validAssignments: BrandAssignmentRow[];
  }
  | {
    ok: false;
    code: "TRACKED_BRAND_REGISTRY_INCOMPLETE" | "TRACKED_BRAND_ASSIGNMENT_INCOMPLETE";
    missingCategories: string[];
  };

/**
 * Validate the tracked-brand setup without mutating project configuration.
 * Tracking runs must not create registry rows or assignments as a side effect:
 * setup belongs in the project settings workflow, not candidate processing.
 */
export function validateTrackedBrandConfiguration(
  brandName: string,
  categoryNames: string[],
  assignments: BrandAssignmentRow[],
  directoryRows: BrandRegistryRow[],
): TrackedBrandConfigurationResult {
  const trackedKey = String(brandName || "Brand").trim().toLocaleLowerCase()
    .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "");

  const trackedRecord = directoryRows.find((row) =>
    row.is_tracked_brand === true || String(row.normalized_key ?? "") === trackedKey
  );

  if (!trackedRecord || !String(trackedRecord.id ?? "")) {
    return {
      ok: false,
      code: "TRACKED_BRAND_REGISTRY_INCOMPLETE",
      missingCategories: [...categoryNames],
    };
  }

  const directoryById = new Map<string, BrandRegistryRow>(
    directoryRows.map((row) => [String(row.id), row]),
  );
  const validAssignments = assignments.filter((row) =>
    directoryById.has(String(row.brand_id))
  );
  const fixedTrackedId = String(trackedRecord.id);
  const assignedTrackedCategories = new Set(validAssignments
    .filter((row) =>
      String(row.brand_id) === fixedTrackedId &&
      String(row.role) === "tracked_brand"
    )
    .map((row) => String(row.category)));

  const missingCategories = categoryNames.filter((category) =>
    !assignedTrackedCategories.has(category)
  );
  if (missingCategories.length) {
    return {
      ok: false,
      code: "TRACKED_BRAND_ASSIGNMENT_INCOMPLETE",
      missingCategories,
    };
  }

  return {
    ok: true,
    trackedRecord,
    fixedTrackedId,
    directoryById,
    validAssignments,
  };
}
