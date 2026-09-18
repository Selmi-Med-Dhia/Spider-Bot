const CHANNELS = 16;
const MAX_DELAY_MS = 60000;

const finiteAngle = (value) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 180;

export function validateCheckpoint(checkpoint) {
  if (!checkpoint || typeof checkpoint !== "object") return "Checkpoint object required";
  if (!Array.isArray(checkpoint.angles) || checkpoint.angles.length !== CHANNELS)
    return "Checkpoint must contain 16 servo angles";
  if (!checkpoint.angles.every(finiteAngle))
    return "Checkpoint angles must be finite values between 0 and 180";
  if (
    !Number.isInteger(checkpoint.delayMs) ||
    checkpoint.delayMs < 0 ||
    checkpoint.delayMs > MAX_DELAY_MS
  )
    return "Checkpoint delay must be an integer between 0 and 60000 ms";
  return "";
}

export function validateMovement(movement) {
  if (!movement || typeof movement !== "object") return "Movement object required";
  if (typeof movement.id !== "string" || !movement.id.trim()) return "Movement id required";
  if (typeof movement.name !== "string" || !movement.name.trim()) return "Movement name required";
  if (!Array.isArray(movement.checkpoints)) return "Movement checkpoints required";
  for (const checkpoint of movement.checkpoints) {
    const error = validateCheckpoint(checkpoint);
    if (error) return error;
  }
  return "";
}

export function parseMovementLibrary(text) {
  if (!text) return [];
  try {
    const value = JSON.parse(text);
    if (!Array.isArray(value)) return [];
    return value.filter((movement) => !validateMovement(movement)).map((movement) => ({
      id: movement.id,
      name: movement.name.trim(),
      checkpoints: movement.checkpoints.map((checkpoint, index) => ({
        id:
          typeof checkpoint.id === "string" && checkpoint.id.trim()
            ? checkpoint.id
            : `${movement.id}-checkpoint-${index + 1}`,
        angles: [...checkpoint.angles],
        delayMs: index === 0 ? 0 : checkpoint.delayMs,
      })),
    }));
  } catch {
    return [];
  }
}

export function playbackPlan(movement) {
  const error = validateMovement(movement);
  if (error) throw new Error(error);
  let atMs = 0;
  return movement.checkpoints.map((checkpoint, index) => {
    if (index > 0) atMs += checkpoint.delayMs;
    return {
      index,
      atMs,
      angles: [...checkpoint.angles],
    };
  });
}
