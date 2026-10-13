export function callFacts(call: any) {
  const raw = String(call.direction || call.type || "").toLowerCase();
  const direction = /inbound|incoming|^in$/.test(raw)
    ? "inbound"
    : /outbound|outgoing|^out$/.test(raw)
      ? "outbound"
      : "unknown";
  const status = String(call.status || "").toLowerCase();
  const reason = String(call.endedReason || "").toLowerCase();
  const explicit = call.successEvaluation ?? call.analysis?.successEvaluation;
  const succeeded =
    explicit === true ||
    explicit === "true" ||
    status === "success" ||
    status === "successful";
  const failed =
    explicit === false ||
    explicit === "false" ||
    ["failed", "error", "no-answer", "busy", "canceled", "cancelled"].includes(
      status,
    ) ||
    /no-answer|busy|failed|error|voicemail|unavailable|not-answered/.test(
      reason,
    );
  const duration = Number(call.durationSeconds ?? call.duration ?? 0);
  const connected =
    call.answered === true ||
    Boolean(call.connectedAt) ||
    duration > 0 ||
    ["answered", "in-progress", "connected"].includes(status);
  const completed = [
    "ended",
    "completed",
    "success",
    "successful",
    "failed",
    "error",
    "no-answer",
    "busy",
    "canceled",
    "cancelled",
  ].includes(status);
  return {
    direction,
    connected,
    completed,
    outcome: succeeded ? "success" : failed ? "failed" : "unknown",
    durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : 0,
  };
}
