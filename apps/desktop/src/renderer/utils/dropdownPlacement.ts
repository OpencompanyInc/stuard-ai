export type DropdownPlacement = "top" | "bottom";

interface ChooseDropdownPlacementOptions {
  currentPlacement?: DropdownPlacement;
  spaceAbove: number;
  spaceBelow: number;
  minComfortableSpace?: number;
  hysteresis?: number;
}

export function chooseDropdownPlacement({
  currentPlacement = "bottom",
  spaceAbove,
  spaceBelow,
  minComfortableSpace = 300,
  hysteresis = 40,
}: ChooseDropdownPlacementOptions): DropdownPlacement {
  const safeAbove = Math.max(0, spaceAbove);
  const safeBelow = Math.max(0, spaceBelow);
  const preferredPlacement: DropdownPlacement =
    safeBelow >= safeAbove ? "bottom" : "top";

  if (safeAbove < minComfortableSpace && safeBelow >= safeAbove) {
    return "bottom";
  }

  if (safeBelow < minComfortableSpace && safeAbove >= safeBelow) {
    return "top";
  }

  if (currentPlacement === "top") {
    return safeBelow - safeAbove > hysteresis ? "bottom" : "top";
  }

  return safeAbove - safeBelow > hysteresis ? "top" : "bottom";
}
