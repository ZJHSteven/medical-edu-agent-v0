import { createRoot } from "react-dom/client";
import { useState } from "react";
import { ModelPicker } from "@/app/model-picker";
import {
  DEFAULT_MODEL_ROUTE_ID,
  type ReasoningEffort
} from "../../shared/model-catalog";
import "@/styles.css";

function Bench() {
  const [routeId, setRouteId] = useState(DEFAULT_MODEL_ROUTE_ID);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>("high");

  return (
    <main className="min-h-dvh bg-background p-12 text-foreground">
      <div className="mx-auto max-w-3xl space-y-6">
        <h1 className="text-lg font-semibold">Exact ModelPicker Bench</h1>
        <ModelPicker
          routeId={routeId}
          reasoningEffort={reasoningEffort}
          onChange={({ routeId: nextRouteId, reasoningEffort: nextEffort }) => {
            setRouteId(nextRouteId);
            setReasoningEffort(nextEffort);
          }}
        />
        <div className="h-[1200px] rounded-2xl border bg-muted/30" />
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Bench />);
